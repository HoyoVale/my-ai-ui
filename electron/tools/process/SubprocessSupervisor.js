import { spawn as nodeSpawn } from "node:child_process";

function asText(chunk) {
  return Buffer.isBuffer(chunk)
    ? chunk.toString("utf8")
    : String(chunk ?? "");
}

function createOutputBuffer(maxBytes) {
  return {
    text: "",
    totalBytes: 0,
    truncated: false,
    maxBytes
  };
}

function appendBounded(state, chunk) {
  const text = asText(chunk);
  const chunkBytes = Buffer.byteLength(text, "utf8");
  state.totalBytes += chunkBytes;

  const combined = `${state.text}${text}`;
  if (Buffer.byteLength(combined, "utf8") <= state.maxBytes) {
    state.text = combined;
    return;
  }

  state.truncated = true;
  const marker = "\n…[output truncated by supervisor]…\n";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const available = Math.max(0, state.maxBytes - markerBytes);
  const headBytes = Math.floor(available * 0.6);
  const tailBytes = available - headBytes;
  const buffer = Buffer.from(combined, "utf8");
  const head = buffer.subarray(0, headBytes).toString("utf8");
  const tail = buffer.subarray(Math.max(0, buffer.length - tailBytes)).toString("utf8");
  state.text = `${head}${marker}${tail}`;
}

function safeNotify(callback, value) {
  if (typeof callback !== "function") return;
  try {
    callback(value);
  } catch (error) {
    console.warn("子进程输出监听器执行失败：", error);
  }
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason.message
    : String(signal?.reason ?? "aborted");
}

export async function terminateProcessTree(
  child,
  {
    platform = process.platform,
    force = false,
    spawnProcess = nodeSpawn
  } = {}
) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return false;
  }

  if (platform === "win32") {
    await new Promise((resolve) => {
      let killer;
      try {
        killer = spawnProcess(
          "taskkill",
          ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
          { windowsHide: true, stdio: "ignore" }
        );
      } catch {
        try {
          child.kill(force ? "SIGKILL" : "SIGTERM");
        } catch {
          // The process may have exited between the state check and kill.
        }
        resolve();
        return;
      }
      killer.once("error", () => {
        try {
          child.kill(force ? "SIGKILL" : "SIGTERM");
        } catch {
          // Best-effort fallback.
        }
        resolve();
      });
      killer.once("exit", resolve);
    });
    return true;
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return false;
    }
  }
  return true;
}

export class SubprocessSupervisor {
  constructor({
    spawnProcess = nodeSpawn,
    platform = process.platform,
    defaultTimeoutMs = 60_000,
    terminationGraceMs = 2_000,
    maxOutputBytes = 2_000_000
  } = {}) {
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.defaultTimeoutMs = Math.max(0, Number(defaultTimeoutMs) || 0);
    this.terminationGraceMs = Math.max(0, Number(terminationGraceMs) || 0);
    this.maxOutputBytes = Math.max(1_024, Number(maxOutputBytes) || 2_000_000);
    this.children = new Map();
  }

  snapshot() {
    return {
      version: 2,
      running: [...this.children.values()].map((entry) => ({
        pid: entry.child.pid,
        command: entry.command,
        startedAt: entry.startedAt,
        terminating: entry.terminating,
        reason: entry.reason
      }))
    };
  }

  async run(command, args = [], options = {}) {
    const executable = String(command ?? "").trim();
    if (!executable) {
      throw new TypeError("Subprocess command is required.");
    }
    if (!Array.isArray(args)) {
      throw new TypeError("Subprocess args must be an array.");
    }

    const timeoutMs = Math.max(
      0,
      Number(options.timeoutMs ?? this.defaultTimeoutMs) || 0
    );
    const graceMs = Math.max(
      0,
      Number(options.terminationGraceMs ?? this.terminationGraceMs) || 0
    );
    const abortSignal = options.abortSignal ?? null;

    if (abortSignal?.aborted) {
      const error = new Error(
        `Subprocess aborted before start: ${abortReason(abortSignal)}`
      );
      error.code = "SUBPROCESS_ABORTED";
      error.name = "AbortError";
      throw error;
    }

    const child = this.spawnProcess(executable, args.map(String), {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: options.shell === true,
      detached: this.platform !== "win32",
      stdio: [
        options.stdin === undefined ? "ignore" : "pipe",
        "pipe",
        "pipe"
      ]
    });

    const entry = {
      child,
      command: executable,
      startedAt: Date.now(),
      terminating: false,
      reason: ""
    };
    const childKey = child.pid ?? Symbol("pending-subprocess");
    this.children.set(childKey, entry);

    const stdout = createOutputBuffer(this.maxOutputBytes);
    const stderr = createOutputBuffer(this.maxOutputBytes);
    child.stdout?.on("data", (chunk) => {
      appendBounded(stdout, chunk);
      safeNotify(options.onStdout, asText(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      appendBounded(stderr, chunk);
      safeNotify(options.onStderr, asText(chunk));
    });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        // EPIPE is expected when a child exits before consuming all input.
      });
      try {
        child.stdin.end(options.stdin);
      } catch {
        // The process may have exited immediately after spawn.
      }
    }

    let timeoutId = null;
    let forceId = null;
    let terminatedBy = "";

    const requestTermination = async (reason) => {
      if (entry.terminating || child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      entry.terminating = true;
      entry.reason = reason;
      terminatedBy = reason;
      await terminateProcessTree(child, {
        platform: this.platform,
        force: false,
        spawnProcess: this.spawnProcess
      });
      forceId = setTimeout(() => {
        void terminateProcessTree(child, {
          platform: this.platform,
          force: true,
          spawnProcess: this.spawnProcess
        });
      }, graceMs);
      forceId.unref?.();
    };

    const onAbort = () => {
      void requestTermination("abort");
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        void requestTermination("timeout");
      }, timeoutMs);
      timeoutId.unref?.();
    }

    try {
      const outcome = await new Promise((resolve, reject) => {
        let settled = false;
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
        child.once("close", (code, signal) => {
          if (settled) return;
          settled = true;
          resolve({ code, signal });
        });
      });

      return {
        ok: outcome.code === 0 && !terminatedBy,
        code: outcome.code,
        signal: outcome.signal,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutBytes: stdout.totalBytes,
        stderrBytes: stderr.totalBytes,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        pid: child.pid,
        durationMs: Math.max(0, Date.now() - entry.startedAt),
        terminated: Boolean(terminatedBy),
        terminationReason: terminatedBy
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceId) clearTimeout(forceId);
      abortSignal?.removeEventListener("abort", onAbort);
      this.children.delete(childKey);
    }
  }

  async terminateAll(reason = "shutdown") {
    const entries = [...this.children.values()];
    await Promise.all(entries.map(async (entry) => {
      entry.terminating = true;
      entry.reason = reason;
      await terminateProcessTree(entry.child, {
        platform: this.platform,
        force: true,
        spawnProcess: this.spawnProcess
      });
    }));
    return entries.length;
  }
}
