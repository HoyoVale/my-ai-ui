import * as internals from "../PlatformKernelInternals.js";

export const PlatformLeaseService = {
  acquireLease({
    platformRunId,
    agentRunId,
    resourceKey,
    mode = "exclusive",
    ttlMs = this.leaseTtlMs
  } = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const key = internals.text(resourceKey, 500);
    if (!key) return { ok: false, code: "lease-resource-invalid" };
  
    this.expireLeases();
    const requestedMode = mode === "shared" ? "shared" : "exclusive";
    const conflicts = Object.values(this.state.leases).filter((lease) =>
      lease.status === "active" &&
      lease.resourceKey === key &&
      lease.agentRunId !== agentRunId &&
      (requestedMode === "exclusive" || lease.mode === "exclusive")
    );
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: "resource-lease-conflict",
        conflicts: conflicts.map((lease) => lease.id)
      };
    }
  
    const timestamp = this.now();
    const lease = {
      version: 1,
      id: this.createId(),
      platformRunId: run.id,
      agentRunId: internals.text(agentRunId, 120),
      resourceKey: key,
      mode: requestedMode,
      status: "active",
      acquiredAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + Math.max(5_000, Number(ttlMs) || this.leaseTtlMs),
      releasedAt: null,
      releaseReason: ""
    };
    this.commit("LEASE_ACQUIRED", { lease });
    return { ok: true, lease: internals.clone(lease) };
  },

  renewLease(leaseId, ttlMs = this.leaseTtlMs) {
    const lease = this.ensureLoaded().leases[internals.text(leaseId, 120)];
    if (!lease || lease.status !== "active") {
      return { ok: false, code: "resource-lease-not-active" };
    }
    const expiresAt = this.now() + Math.max(5_000, Number(ttlMs) || this.leaseTtlMs);
    this.commit("LEASE_RENEWED", { leaseId: lease.id, expiresAt });
    return { ok: true, lease: internals.clone(lease) };
  },

  releaseLease(leaseId, reason = "released") {
    const lease = this.ensureLoaded().leases[internals.text(leaseId, 120)];
    if (!lease || lease.status !== "active") {
      return { ok: true, changed: false };
    }
    this.commit("LEASE_RELEASED", {
      leaseId: lease.id,
      reason: internals.text(reason)
    });
    return { ok: true, changed: true };
  },

  expireLeases() {
    const now = this.now();
    const expired = Object.values(this.ensureLoaded().leases)
      .filter((lease) => lease.status === "active" && lease.expiresAt <= now);
    for (const lease of expired) {
      this.commit("LEASE_EXPIRED", {
        leaseId: lease.id,
        reason: "lease-timeout"
      });
    }
    return expired.map((lease) => lease.id);
  }
};
