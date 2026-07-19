import {
  useEffect,
  useState
} from "react";

function hasStructuredRun(status) {
  return Boolean(
    status &&
    typeof status === "object" &&
    status.runId
  );
}

export function useResponseStream() {
  const [text, setText] =
    useState("");

  const [streaming, setStreaming] =
    useState(false);

  const [side, setSide] =
    useState("right");

  const [streamId, setStreamId] =
    useState(0);

  const [agentStatus, setAgentStatus] =
    useState(null);

  useEffect(() => {
    let disposed = false;

    window.api
      ?.getAgentStatus?.()
      .then((status) => {
        if (
          !disposed &&
          hasStructuredRun(status)
        ) {
          setAgentStatus(status);
        }
      })
      .catch(() => {
        // Response 仍可通过传统文本流工作。
      });

    const offStatus =
      window.api
        ?.onAgentStatusChanged?.(
          (status) => {
            if (
              !disposed &&
              hasStructuredRun(status)
            ) {
              /*
               * 只保存有 runId 的结构化快照。
               * run 结束后的 idle 状态不会覆盖最后一次活动和最终回复，
               * 因而自动关闭前仍能完整展示工具流与答案。
               */
              setAgentStatus(status);
            }
          }
        );

    const offStart =
      window.api?.onResponseStart?.(
        () => {
          setText("");
          setAgentStatus(null);
          setStreaming(true);

          setStreamId(
            (current) =>
              current + 1
          );
        }
      );

    const offChunk =
      window.api?.onResponseChunk?.(
        (chunk) => {
          setStreaming(true);

          setText((current) => {
            return current + chunk;
          });
        }
      );

    const offEnd =
      window.api?.onResponseEnd?.(
        () => {
          setStreaming(false);
        }
      );

    const offClear =
      window.api?.onResponseClear?.(
        () => {
          setText("");
          setAgentStatus(null);
          setStreaming(false);
        }
      );

    const offSide =
      window.api
        ?.onResponseSideChange?.(
          setSide
        );

    return () => {
      disposed = true;
      offStatus?.();
      offStart?.();
      offChunk?.();
      offEnd?.();
      offClear?.();
      offSide?.();
    };
  }, []);

  return {
    text,
    agentStatus,
    streaming,
    side,
    streamId
  };
}
