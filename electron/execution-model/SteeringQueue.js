import crypto from "node:crypto";

function text(value, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class SteeringQueue {
  constructor({
    maxItems = 50,
    createId = () => crypto.randomUUID(),
    now = () => Date.now()
  } = {}) {
    this.maxItems = Math.max(1, Math.min(200, Number(maxItems) || 50));
    this.createId = createId;
    this.now = now;
    this.items = [];
  }

  enqueue({ threadId, runId, content, source = "user" } = {}) {
    const item = {
      version: 1,
      id: text(this.createId(), 160),
      threadId: text(threadId, 160),
      runId: text(runId, 160),
      content: text(content),
      source: text(source, 40) || "user",
      status: "queued",
      createdAt: Math.max(0, Math.round(Number(this.now()) || Date.now()))
    };
    if (!item.id || !item.threadId || !item.runId || !item.content) return null;
    this.items.push(item);
    if (this.items.length > this.maxItems) {
      this.items.splice(0, this.items.length - this.maxItems);
    }
    return clone(item);
  }

  peek({ threadId = "", runId = "" } = {}) {
    return this.items
      .filter((item) => (
        item.status === "queued" &&
        (!threadId || item.threadId === threadId) &&
        (!runId || item.runId === runId)
      ))
      .map(clone);
  }

  drain({ threadId, runId } = {}) {
    const selected = [];
    this.items = this.items.filter((item) => {
      const matches = item.status === "queued" &&
        (!threadId || item.threadId === threadId) &&
        (!runId || item.runId === runId);
      if (matches) {
        selected.push({ ...item, status: "consumed" });
        return false;
      }
      return true;
    });
    return selected.map(clone);
  }

  cancelRun(runId) {
    const normalizedRunId = text(runId, 160);
    let count = 0;
    this.items = this.items.map((item) => {
      if (item.runId !== normalizedRunId || item.status !== "queued") return item;
      count += 1;
      return { ...item, status: "cancelled" };
    });
    return count;
  }

  clear() {
    this.items = [];
  }
}

export const steeringQueue = new SteeringQueue();
