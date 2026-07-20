import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  applyAgentStatusPatch,
  applyAgentTextEvent,
  resolveAgentStatusRevision
} from "../agentStatusProtocol.js";

const INITIAL_STATUS = {
  state: "idle",
  runId: null,
  conversationId: null,
  startedAt: null,
  lastError: null,
  stopReason: null,
  plan: [],
  activeToolCalls: [],
  activity: null,
  liveStepText: "",
  finalText: "",
  assistantText: ""
};

function envelopeStatus(value) {
  if (
    value &&
    typeof value === "object" &&
    value.status &&
    typeof value.status === "object"
  ) {
    return value.status;
  }
  return value;
}

export function useAgentStatus() {
  const [status, setStatus] =
    useState(INITIAL_STATUS);
  const revisionRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const api = window.api;
    const incremental =
      typeof api?.getAgentSnapshot === "function" &&
      typeof api?.onAgentSnapshotChanged === "function";

    const acceptRevision = (value) => {
      const decision = resolveAgentStatusRevision(
        revisionRef.current,
        value
      );
      revisionRef.current = decision.revision;
      return decision.accepted;
    };

    const load = incremental
      ? api.getAgentSnapshot()
      : api?.getAgentStatus?.();

    Promise.resolve(load)
      .then((value) => {
        if (!disposed && value) {
          if (incremental && !acceptRevision(value)) {
            return;
          }
          setStatus({
            ...INITIAL_STATUS,
            ...envelopeStatus(value)
          });
        }
      })
      .catch((error) => {
        console.error(
          "读取 Agent 状态失败：",
          error
        );
      });

    if (!incremental) {
      const unsubscribe = api?.onAgentStatusChanged?.((value) => {
        if (!disposed && value) {
          setStatus({
            ...INITIAL_STATUS,
            ...value
          });
        }
      });
      return () => {
        disposed = true;
        unsubscribe?.();
      };
    }

    const offSnapshot = api.onAgentSnapshotChanged((envelope) => {
      if (disposed || !envelope || !acceptRevision(envelope)) {
        return;
      }
      setStatus({
        ...INITIAL_STATUS,
        ...envelopeStatus(envelope)
      });
    });

    const offPatch = api.onAgentStatusPatch((patch) => {
      if (disposed || !patch || !acceptRevision(patch)) {
        return;
      }
      setStatus((current) => applyAgentStatusPatch(current, patch));
    });

    const offText = api.onAgentTextChunk((event) => {
      if (disposed || !event || !acceptRevision(event)) {
        return;
      }
      setStatus((current) => applyAgentTextEvent(current, event));
    });

    return () => {
      disposed = true;
      offSnapshot?.();
      offPatch?.();
      offText?.();
    };
  }, []);

  return {
    status,
    isRunning:
      status.state === "running" ||
      ["stopping", "cancelling"].includes(status.state)
  };
}
