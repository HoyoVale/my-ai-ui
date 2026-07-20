import {
  spawn as nodeSpawn
} from "node:child_process";

function asText(chunk) {
  return Buffer.isBuffer(chunk)
    ? chunk.toString("utf8")
    : String(chunk ?? "");
}

function appendBounded(current, chunk, maxBytes) {
  const combined = `${current}${asText(chunk)}`;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) {
    return combined;
  }

  const buffer = Buffer.from(combined, "utf8");
  return buffer.subarray(buffer.length - maxBytes).toString("utf8");
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
  if (!child?.pid || child.exitCode !== null || child.killed) {
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
        child.kill(force ? "SIGKILL" : "SIGTERM");
        resolve();
        return;
      }
      killer.once("error", () => {
        child.kill(force ? "SIGKILL" : "SIGTERM");
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
      version: 1,
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
      const error = new Error(`Subprocess aborted before start: ${abortReason(abortSignal)}`);
      error.code = "SUBPROCESS_ABORTED";
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
    this.children.set(child.pid, entry);

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk, this.maxOutputBytes);
      options.onStdout?.(asText(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk, this.maxOutputBytes);
      options.onStderr?.(asText(chunk));
    });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.end(options.stdin);
    }

    let timeoutId = null;
    let forceId = null;
    let terminatedBy = "";

    const requestTermination = async (reason) => {
      if (entry.terminating || child.exitCode !== null) {
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
      if (graceMs >= 0) {
        forceId = setTimeout(() => {
          void terminateProcessTree(child, {
            platform: this.platform,
            force: true,
            spawnProcess: this.spawnProcess
          });
        }, graceMs);
        forceId.unref?.();
      }
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
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });

      return {
        ok: outcome.code === 0 && !terminatedBy,
        code: outcome.code,
        signal: outcome.signal,
        stdout,
        stderr,
        pid: child.pid,
        durationMs: Math.max(0, Date.now() - entry.startedAt),
        terminated: Boolean(terminatedBy),
        terminationReason: terminatedBy
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (forceId) {
        clearTimeout(forceId);
      }
      abortSignal?.removeEventListener("abort", onAbort);
      this.children.delete(child.pid);
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
