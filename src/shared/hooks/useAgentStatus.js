import {
  useEffect,
  useState
} from "react";

const INITIAL_STATUS = {
  state: "idle",
  runId: null,
  conversationId: null,
  startedAt: null,
  lastError: null,
  pendingQuestion: null,
  stopReason: null,
  plan: [],
  activeToolCalls: []
};

export function useAgentStatus() {
  const [status, setStatus] =
    useState(
      INITIAL_STATUS
    );

  useEffect(() => {
    let disposed = false;

    window.api
      ?.getAgentStatus?.()
      .then((value) => {
        if (
          !disposed &&
          value
        ) {
          setStatus(value);
        }
      })
      .catch((error) => {
        console.error(
          "读取 Agent 状态失败：",
          error
        );
      });

    const unsubscribe =
      window.api
        ?.onAgentStatusChanged?.(
          (value) => {
            if (
              !disposed &&
              value
            ) {
              setStatus(value);
            }
          }
        );

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return {
    status,
    isRunning:
      status.state ===
        "running" ||
      status.state ===
        "stopping",
    isWaitingForUser:
      status.state ===
        "waiting_for_user"
  };
}
