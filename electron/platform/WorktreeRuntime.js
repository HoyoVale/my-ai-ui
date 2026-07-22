import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  SubprocessSupervisor
} from "../tools/process/SubprocessSupervisor.js";

const gitSupervisor = new SubprocessSupervisor({
  defaultTimeoutMs: 120_000,
  maxOutputBytes: 16 * 1024 * 1024
});

function text(value, limit = 240) {
  return String(value ?? "").trim().slice(0, limit);
}

function clone(value) {
  return structuredClone(value);
}

function safePart(value, fallback = "item") {
  return text(value, 80)
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || fallback;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporary, filePath);
}

function git(cwd, args, { env = {}, input = undefined, allowFailure = false } = {}) {
  const result = gitSupervisor.runSync("git", [
    "-c", "core.longpaths=true", "-C", cwd, ...args
  ], {
    stdin: input,
    env: { ...process.env, ...env },
    maxOutputBytes: 16 * 1024 * 1024
  });
  if (result.exitCode !== 0 && !allowFailure) {
    const error = new Error(
      text(result.stderr || result.stdout || `git exited with ${result.exitCode}`, 2000)
    );
    error.code = "WORKTREE_GIT_FAILED";
    error.exitCode = result.exitCode;
    error.args = [...args];
    throw error;
  }
  return {
    ok: result.exitCode === 0,
    status: result.exitCode,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim()
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class WorktreeRuntime {
  constructor({
    getStorageDirectory,
    platformKernel,
    now = () => Date.now(),
    createId = () => crypto.randomUUID()
  } = {}) {
    if (typeof getStorageDirectory !== "function") {
      throw new TypeError("WorktreeRuntime requires getStorageDirectory().");
    }
    if (!platformKernel) {
      throw new TypeError("WorktreeRuntime requires PlatformKernel.");
    }
    this.getStorageDirectory = getStorageDirectory;
    this.platformKernel = platformKernel;
    this.now = now;
    this.createId = createId;
    this.registry = null;
  }

  get rootDirectory() {
    return path.resolve(this.getStorageDirectory());
  }

  get registryPath() {
    return path.join(this.rootDirectory, "worktrees.json");
  }

  ensureLoaded() {
    if (this.registry) return this.registry;
    fs.mkdirSync(this.rootDirectory, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, "utf8"));
      this.registry = parsed?.version === 1 && parsed.worktrees
        ? parsed
        : { version: 1, worktrees: {}, updatedAt: 0 };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const backup = `${this.registryPath}.corrupt-${this.now()}`;
        fs.renameSync(this.registryPath, backup);
      }
      this.registry = { version: 1, worktrees: {}, updatedAt: 0 };
    }
    return this.registry;
  }

  save() {
    this.registry.updatedAt = this.now();
    atomicWrite(this.registryPath, this.registry);
  }

  inspectRepository(workspaceRoot) {
    const requested = path.resolve(text(workspaceRoot, 2000));
    if (!fs.existsSync(requested)) {
      return { ok: false, code: "workspace-not-found" };
    }
    const top = git(requested, ["rev-parse", "--show-toplevel"], { allowFailure: true });
    if (!top.ok) {
      return { ok: false, code: "workspace-not-git-repository" };
    }
    const repositoryRoot = path.resolve(top.stdout);
    const head = git(repositoryRoot, ["rev-parse", "HEAD"], { allowFailure: true });
    if (!head.ok) {
      return { ok: false, code: "workspace-git-head-missing" };
    }
    const status = git(repositoryRoot, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all"
    ]);
    return {
      ok: true,
      repositoryRoot,
      head: head.stdout,
      dirty: status.stdout.length > 0
    };
  }

  createBaselineSnapshot(repository) {
    if (!repository.dirty) {
      return {
        commit: repository.head,
        kind: "head",
        capturedDirtyState: false
      };
    }

    fs.mkdirSync(this.rootDirectory, { recursive: true });
    const indexPath = path.join(
      this.rootDirectory,
      `.snapshot-index-${process.pid}-${this.createId()}`
    );
    const environment = {
      GIT_INDEX_FILE: indexPath,
      GIT_AUTHOR_NAME: "Xixi Snapshot",
      GIT_AUTHOR_EMAIL: "xixi-snapshot@local.invalid",
      GIT_COMMITTER_NAME: "Xixi Snapshot",
      GIT_COMMITTER_EMAIL: "xixi-snapshot@local.invalid"
    };
    try {
      git(repository.repositoryRoot, ["read-tree", repository.head], { env: environment });
      git(repository.repositoryRoot, ["add", "-A", "--", "."], { env: environment });
      const tree = git(repository.repositoryRoot, ["write-tree"], { env: environment });
      const commit = git(
        repository.repositoryRoot,
        ["commit-tree", tree.stdout, "-p", repository.head],
        {
          env: environment,
          input: "Xixi isolated dirty-workspace snapshot\n"
        }
      );
      return {
        commit: commit.stdout,
        kind: "temporary-commit",
        capturedDirtyState: true
      };
    } finally {
      fs.rmSync(indexPath, { force: true });
    }
  }

  create({
    platformRunId,
    agentRunId,
    taskId,
    workspaceRoot,
    role = "implementer",
    writable = true,
    baselineCommit = null
  } = {}) {
    const repository = this.inspectRepository(workspaceRoot);
    if (!repository.ok) return repository;
    this.ensureLoaded();

    const id = this.createId();
    const runPart = safePart(platformRunId, "run").slice(0, 20);
    const agentPart = safePart(agentRunId, "agent").slice(0, 20);
    const worktreePath = path.join(this.rootDirectory, runPart, `${agentPart}-${id.slice(0, 8)}`);
    if (!isInside(this.rootDirectory, worktreePath)) {
      return { ok: false, code: "worktree-path-outside-storage" };
    }

    const requestedBaseline = text(baselineCommit, 120);
    if (requestedBaseline) {
      const verifiedBaseline = git(repository.repositoryRoot, [
        "cat-file", "-e", `${requestedBaseline}^{commit}`
      ], { allowFailure: true });
      if (!verifiedBaseline.ok) {
        return { ok: false, code: "worktree-baseline-commit-invalid" };
      }
    }
    const baseline = requestedBaseline
      ? {
          commit: requestedBaseline,
          kind: "specified-commit",
          capturedDirtyState: false
        }
      : this.createBaselineSnapshot(repository);
    const branch = `xixi/${runPart}/${agentPart}-${id.slice(0, 8)}`;
    const timestamp = this.now();
    const record = {
      version: 1,
      id,
      platformRunId: text(platformRunId, 120),
      agentRunId: text(agentRunId, 120),
      taskId: text(taskId, 120),
      role: text(role, 80),
      repositoryRoot: repository.repositoryRoot,
      path: path.resolve(worktreePath),
      branch,
      baselineCommit: baseline.commit,
      baselineKind: baseline.kind,
      capturedDirtyState: baseline.capturedDirtyState,
      writable: Boolean(writable),
      leaseId: null,
      status: "creating",
      checkpointCommit: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.registry.worktrees[id] = record;
    this.save();
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    try {
      git(repository.repositoryRoot, [
        "worktree", "add", "--no-checkout", "-b", branch, worktreePath, baseline.commit
      ]);
      git(worktreePath, ["checkout", "--force"]);
    } catch (error) {
      git(repository.repositoryRoot, ["worktree", "remove", "--force", worktreePath], {
        allowFailure: true
      });
      record.status = "failed";
      record.failureReason = "worktree-create-failed";
      record.updatedAt = this.now();
      this.save();
      throw error;
    }

    const lease = this.platformKernel.acquireLease({
      platformRunId,
      agentRunId,
      resourceKey: `worktree:${path.resolve(worktreePath)}`,
      mode: writable ? "exclusive" : "shared"
    });
    if (!lease.ok) {
      git(repository.repositoryRoot, ["worktree", "remove", "--force", worktreePath], {
        allowFailure: true
      });
      record.status = "failed";
      record.failureReason = lease.code;
      record.updatedAt = this.now();
      this.save();
      return lease;
    }
    record.leaseId = lease.lease.id;
    record.status = "active";
    record.updatedAt = this.now();
    this.save();
    return { ok: true, worktree: clone(record) };
  }

  get(worktreeId) {
    const record = this.ensureLoaded().worktrees[text(worktreeId, 120)];
    return record ? clone(record) : null;
  }

  getForAgent(agentRunId) {
    return Object.values(this.ensureLoaded().worktrees)
      .find((item) => item.agentRunId === agentRunId && item.status === "active") ?? null;
  }

  assertAgentPath(agentRunId, candidatePath) {
    const worktree = this.getForAgent(text(agentRunId, 120));
    if (!worktree) return { ok: false, code: "agent-worktree-not-found" };
    const resolved = path.resolve(worktree.path, text(candidatePath, 2000) || ".");
    if (!isInside(worktree.path, resolved)) {
      return { ok: false, code: "agent-worktree-boundary-violation" };
    }
    return { ok: true, path: resolved, worktree: clone(worktree) };
  }

  checkpoint(worktreeId, message = "Worker checkpoint") {
    const record = this.ensureLoaded().worktrees[text(worktreeId, 120)];
    if (!record || record.status !== "active") {
      return { ok: false, code: "worktree-not-active" };
    }
    if (!fs.existsSync(record.path)) {
      return { ok: false, code: "worktree-path-missing" };
    }
    const status = git(record.path, ["status", "--porcelain=v1", "-z"]);
    if (status.stdout) {
      git(record.path, ["add", "-A", "--", "."]);
      git(record.path, [
        "-c", "user.name=Xixi Worker",
        "-c", "user.email=xixi-worker@local.invalid",
        "commit", "--no-gpg-sign", "-m", text(message, 160) || "Worker checkpoint"
      ]);
    }
    const commit = git(record.path, ["rev-parse", "HEAD"]).stdout;
    const changed = commit !== record.baselineCommit;
    record.checkpointCommit = commit;
    record.updatedAt = this.now();
    this.save();
    const agent = this.platformKernel.getRun(record.platformRunId)
      ?.agentRuns?.[record.agentRunId];
    if (
      record.writable &&
      agent?.kind !== "evaluator" &&
      typeof this.platformKernel.recordTaskCheckpoint === "function"
    ) {
      this.platformKernel.recordTaskCheckpoint(record.platformRunId, record.taskId, {
        agentRunId: record.agentRunId,
        commit,
        baselineCommit: record.baselineCommit,
        changed,
        recordedAt: this.now()
      });
    }
    return {
      ok: true,
      changed,
      commit,
      worktree: clone(record)
    };
  }

  integrateCommits(worktreeId, commits = [], message = "Integrate Worker changes") {
    const record = this.ensureLoaded().worktrees[text(worktreeId, 120)];
    if (!record || record.status !== "active") {
      return { ok: false, code: "worktree-not-active" };
    }
    if (!record.writable) {
      return { ok: false, code: "worktree-read-only" };
    }

    const requested = [...new Set(
      (Array.isArray(commits) ? commits : [])
        .map((value) => text(value, 120))
        .filter(Boolean)
    )];
    if (requested.length === 0) {
      return { ok: false, code: "integration-commits-empty" };
    }

    const startCommit = git(record.path, ["rev-parse", "HEAD"]).stdout;
    const applied = [];
    for (const commit of requested) {
      const verified = git(record.repositoryRoot, [
        "cat-file", "-e", `${commit}^{commit}`
      ], { allowFailure: true });
      if (!verified.ok) {
        git(record.path, ["reset", "--hard", startCommit], { allowFailure: true });
        return {
          ok: false,
          code: "integration-commit-invalid",
          commit,
          applied
        };
      }

      const picked = git(record.path, [
        "cherry-pick", "--no-commit", commit
      ], { allowFailure: true });
      if (!picked.ok) {
        const conflicts = git(record.path, [
          "diff", "--name-only", "--diff-filter=U", "--"
        ], { allowFailure: true }).stdout
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean);
        git(record.path, ["cherry-pick", "--abort"], { allowFailure: true });
        git(record.path, ["reset", "--hard", startCommit], { allowFailure: true });
        return {
          ok: false,
          code: conflicts.length > 0
            ? "integration-conflict"
            : "integration-cherry-pick-failed",
          commit,
          applied,
          conflicts,
          error: text(picked.stderr || picked.stdout, 2000)
        };
      }
      applied.push(commit);
    }

    const status = git(record.path, ["status", "--porcelain=v1", "-z"]);
    if (status.stdout) {
      git(record.path, [
        "-c", "user.name=Xixi Integrator",
        "-c", "user.email=xixi-integrator@local.invalid",
        "commit", "--no-gpg-sign", "-m",
        text(message, 160) || "Integrate Worker changes"
      ]);
    }
    const commit = git(record.path, ["rev-parse", "HEAD"]).stdout;
    record.checkpointCommit = commit;
    record.updatedAt = this.now();
    this.save();
    return {
      ok: true,
      changed: commit !== startCommit,
      baselineCommit: startCommit,
      commit,
      applied,
      worktree: clone(record)
    };
  }

  publishIntegration({
    workspaceRoot,
    baselineCommit,
    integrationCommit
  } = {}) {
    const repository = this.inspectRepository(workspaceRoot);
    if (!repository.ok) return repository;
    const baseline = text(baselineCommit, 120);
    const integrated = text(integrationCommit, 120);
    for (const commit of [baseline, integrated]) {
      const verified = git(repository.repositoryRoot, [
        "cat-file", "-e", `${commit}^{commit}`
      ], { allowFailure: true });
      if (!verified.ok) {
        return { ok: false, code: "integration-publication-commit-invalid" };
      }
    }

    const currentSnapshot = this.createBaselineSnapshot(repository);
    const baselineTree = git(repository.repositoryRoot, [
      "rev-parse", `${baseline}^{tree}`
    ]).stdout;
    const currentTree = git(repository.repositoryRoot, [
      "rev-parse", `${currentSnapshot.commit}^{tree}`
    ]).stdout;
    if (currentTree !== baselineTree) {
      return {
        ok: false,
        code: "integration-target-changed",
        baselineTree,
        currentTree
      };
    }

    const branchBefore = git(repository.repositoryRoot, [
      "branch", "--show-current"
    ], { allowFailure: true }).stdout;
    const indexBefore = git(repository.repositoryRoot, [
      "diff", "--cached", "--binary", "--"
    ]).stdout;
    const patch = git(repository.repositoryRoot, [
      "diff", "--binary", baseline, integrated, "--"
    ]).stdout;
    if (patch) {
      const patchInput = `${patch}\n`;
      const checked = git(repository.repositoryRoot, [
        "apply", "--check", "--binary", "--whitespace=nowarn", "-"
      ], { input: patchInput, allowFailure: true });
      if (!checked.ok) {
        return {
          ok: false,
          code: "integration-publication-check-failed",
          error: text(checked.stderr || checked.stdout, 2000)
        };
      }
      const applied = git(repository.repositoryRoot, [
        "apply", "--binary", "--whitespace=nowarn", "-"
      ], { input: patchInput, allowFailure: true });
      if (!applied.ok) {
        return {
          ok: false,
          code: "integration-publication-failed",
          error: text(applied.stderr || applied.stdout, 2000)
        };
      }
    }

    const publishedRepository = this.inspectRepository(repository.repositoryRoot);
    const publishedSnapshot = this.createBaselineSnapshot(publishedRepository);
    const publishedTree = git(repository.repositoryRoot, [
      "rev-parse", `${publishedSnapshot.commit}^{tree}`
    ]).stdout;
    const integrationTree = git(repository.repositoryRoot, [
      "rev-parse", `${integrated}^{tree}`
    ]).stdout;
    const branchAfter = git(repository.repositoryRoot, [
      "branch", "--show-current"
    ], { allowFailure: true }).stdout;
    const indexAfter = git(repository.repositoryRoot, [
      "diff", "--cached", "--binary", "--"
    ]).stdout;
    if (
      publishedTree !== integrationTree ||
      branchAfter !== branchBefore ||
      indexAfter !== indexBefore
    ) {
      const rollback = patch
        ? git(repository.repositoryRoot, [
            "apply", "--reverse", "--binary", "--whitespace=nowarn", "-"
          ], { input: `${patch}\n`, allowFailure: true })
        : { ok: true };
      return {
        ok: false,
        code: "integration-publication-verification-failed",
        publishedTree,
        integrationTree,
        branchPreserved: branchAfter === branchBefore,
        indexPreserved: indexAfter === indexBefore,
        rollbackSucceeded: rollback.ok === true
      };
    }
    return {
      ok: true,
      changed: Boolean(patch),
      commit: integrated,
      tree: integrationTree,
      branchPreserved: true,
      indexPreserved: true
    };
  }

  release(worktreeId, { reason = "worker-finished", remove = true } = {}) {
    const record = this.ensureLoaded().worktrees[text(worktreeId, 120)];
    if (!record) return { ok: true, changed: false };
    if (record.status !== "active") {
      return { ok: true, changed: false, worktree: clone(record) };
    }

    const checkpoint = fs.existsSync(record.path)
      ? this.checkpoint(record.id, `${record.role || "Worker"}: ${reason}`)
      : { ok: false, code: "worktree-path-missing" };
    if (!checkpoint.ok && checkpoint.code !== "worktree-path-missing") {
      return checkpoint;
    }
    this.platformKernel.releaseLease(record.leaseId, reason);

    let removed = false;
    if (remove && checkpoint.ok) {
      const result = git(record.repositoryRoot, [
        "worktree", "remove", "--force", record.path
      ], { allowFailure: true });
      removed = result.ok;
    }
    record.status = removed ? "archived" : "retained";
    record.releaseReason = text(reason, 240);
    record.checkpointCommit = checkpoint.commit ?? record.checkpointCommit;
    record.updatedAt = this.now();
    record.releasedAt = this.now();
    this.save();
    return { ok: true, changed: true, removed, worktree: clone(record) };
  }

  recover() {
    const registry = this.ensureLoaded();
    const recovered = [];
    for (const name of fs.readdirSync(this.rootDirectory)) {
      if (name.startsWith(".snapshot-index-")) {
        fs.rmSync(path.join(this.rootDirectory, name), { force: true });
      }
    }
    for (const record of Object.values(registry.worktrees)) {
      if (record.status === "creating") {
        if (!fs.existsSync(record.path)) {
          record.status = "failed";
          record.failureReason = "interrupted-before-worktree-created";
          record.updatedAt = this.now();
          recovered.push(record.id);
          continue;
        }
        const head = git(record.path, ["rev-parse", "HEAD"], { allowFailure: true });
        if (!head.ok) {
          record.status = "retained";
          record.failureReason = "interrupted-worktree-needs-manual-recovery";
          record.updatedAt = this.now();
          recovered.push(record.id);
          continue;
        }
        record.status = "active";
        record.checkpointCommit = head.stdout;
      }
      if (record.status !== "active") continue;
      if (!fs.existsSync(record.path)) {
        if (record.leaseId) {
          this.platformKernel.releaseLease(record.leaseId, "worktree-missing-on-restart");
        }
        record.status = "missing";
        record.updatedAt = this.now();
        recovered.push(record.id);
        continue;
      }
      const agent = this.platformKernel.getRun(record.platformRunId)
        ?.agentRuns?.[record.agentRunId];
      if (!agent || agent.status !== "running") {
        const result = this.release(record.id, {
          reason: "orphaned-worktree-recovered",
          remove: true
        });
        if (result.ok) recovered.push(record.id);
      }
    }
    this.save();
    return { ok: true, recoveredWorktreeIds: recovered };
  }

  getSnapshot() {
    return {
      version: 1,
      worktrees: Object.values(this.ensureLoaded().worktrees).map((record) => ({
        id: record.id,
        platformRunId: record.platformRunId,
        agentRunId: record.agentRunId,
        taskId: record.taskId,
        role: record.role,
        branch: record.branch,
        baselineCommit: record.baselineCommit,
        checkpointCommit: record.checkpointCommit,
        capturedDirtyState: record.capturedDirtyState,
        writable: record.writable,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }))
    };
  }
}
