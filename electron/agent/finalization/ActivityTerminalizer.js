const OPEN_STATUSES = new Set([
  "queued",
  "running",
  "in_progress",
  "retrying",
  "cancelling"
]);

function terminalStatus(outcome, activityStatus = "") {
  if (outcome === "completed") return "completed";
  if (outcome === "failed" || activityStatus === "failed") return "failed";
  if (outcome === "cancelled" || activityStatus === "cancelled") return "cancelled";
  return "interrupted";
}

function terminalizeTool(tool, status, endedAt) {
  if (!tool || typeof tool !== "object") return tool;
  const current = String(tool.status ?? "");
  if (!OPEN_STATUSES.has(current)) return tool;
  return {
    ...tool,
    status,
    endedAt: tool.endedAt ?? endedAt
  };
}

function terminalizeBatch(batch, status, endedAt) {
  if (!batch || typeof batch !== "object") return batch;
  const current = String(batch.status ?? "");
  if (!OPEN_STATUSES.has(current)) return batch;
  return {
    ...batch,
    status,
    endedAt: batch.endedAt ?? endedAt
  };
}

export function terminalizeActivityEvents(events = [], {
  outcome = "",
  activityStatus = "",
  endedAt = Date.now()
} = {}) {
  const status = terminalStatus(outcome, activityStatus);

  return (Array.isArray(events) ? events : []).map((event) => {
    if (!event || typeof event !== "object") return event;
    const eventStatus = String(event.status ?? "");
    const tool = terminalizeTool(event.tool, status, endedAt);
    const batch = terminalizeBatch(event.batch, status, endedAt);
    const open = OPEN_STATUSES.has(eventStatus);

    if (!open && tool === event.tool && batch === event.batch) {
      return event;
    }

    return {
      ...event,
      status: open ? status : event.status,
      tool,
      batch,
      updatedAt: Math.max(
        Number(event.updatedAt) || 0,
        Number(endedAt) || Date.now()
      )
    };
  });
}

export function terminalizeToolRecords(records = [], {
  outcome = "",
  activityStatus = "",
  endedAt = Date.now()
} = {}) {
  const status = terminalStatus(outcome, activityStatus);

  return (Array.isArray(records) ? records : []).map((record) => {
    if (!record || typeof record !== "object") return record;
    if (!OPEN_STATUSES.has(String(record.status ?? ""))) return record;
    return {
      ...record,
      status,
      endedAt: record.endedAt ?? endedAt,
      runtime: record.runtime && typeof record.runtime === "object"
        ? {
            ...record.runtime,
            terminalized: true,
            terminalizedAs: status
          }
        : {
            terminalized: true,
            terminalizedAs: status
          }
    };
  });
}

export function hasOpenActivity(events = []) {
  return (Array.isArray(events) ? events : []).some((event) =>
    OPEN_STATUSES.has(String(event?.status ?? "")) ||
    OPEN_STATUSES.has(String(event?.tool?.status ?? "")) ||
    OPEN_STATUSES.has(String(event?.batch?.status ?? ""))
  );
}
