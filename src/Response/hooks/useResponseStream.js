import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  applyAgentStatusPatch,
  applyAgentTextEvent,
  resolveAgentStatusRevision
} from "../../shared/agentStatusProtocol.js";

function hasStructuredRun(status) {
  return Boolean(
    status &&
    typeof status === "object" &&
    status.runId
  );
}

function envelopeStatus(value) {
  return value?.status && typeof value.status === "object"
    ? value.status
    : value;
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

    let hasIncrementalBase = false;
    let resyncing = false;

    const requestCompactSnapshot = async () => {
      if (!incremental || resyncing || disposed) {
        return;
      }
      resyncing = true;
      try {
        const envelope = await api.getAgentSnapshot();
        const status = envelopeStatus(envelope);
        if (
          !disposed &&
          envelope &&
          acceptRevision(envelope) &&
          hasStructuredRun(status)
        ) {
          hasIncrementalBase = true;
          setAgentStatus(status);
        }
      } catch {
        // Response 仍可通过传统文本流工作。
      } finally {
        resyncing = false;
      }
    };

    if (incremental) {
      void requestCompactSnapshot();
    } else {
      Promise.resolve(api?.getAgentStatus?.())
        .then((status) => {
          if (!disposed && hasStructuredRun(status)) {
            setAgentStatus(status);
          }
        })
        .catch(() => {
          // Response 仍可通过传统文本流工作。
        });
    }

    let offStatus = null;
    let offSnapshot = null;
    let offPatch = null;
    let offText = null;

    if (incremental) {
      offSnapshot = api.onAgentSnapshotChanged((envelope) => {
        const status = envelopeStatus(envelope);
        if (
          disposed ||
          !envelope ||
          !acceptRevision(envelope) ||
          !hasStructuredRun(status)
        ) {
          return;
        }
        hasIncrementalBase = true;
        setAgentStatus(status);
      });

      offPatch = api.onAgentStatusPatch((patch) => {
        if (disposed || !patch || !acceptRevision(patch)) {
          return;
        }
        if (!hasIncrementalBase) {
          void requestCompactSnapshot();
          return;
        }
        setAgentStatus((current) =>
          applyAgentStatusPatch(current, patch)
        );
      });

      offText = api.onAgentTextChunk((event) => {
        if (disposed || !event || !acceptRevision(event)) {
          return;
        }
        if (!hasIncrementalBase) {
          void requestCompactSnapshot();
          return;
        }
        setAgentStatus((current) =>
          applyAgentTextEvent(current, event)
        );
      });
    } else {
      offStatus = api?.onAgentStatusChanged?.((status) => {
        if (!disposed && hasStructuredRun(status)) {
          setAgentStatus(status);
        }
      });
    }

    const offStart =
      api?.onResponseStart?.(
        () => {
          setText("");
          setStreaming(true);

          /*
           * The run snapshot can arrive just before the legacy response-start
           * signal. Do not discard it and then wait for a patch that cannot be
           * applied without a base snapshot. Re-request the compact Response
           * projection so the stream always has a valid incremental base.
           */
          setAgentStatus(null);
          if (incremental) {
            hasIncrementalBase = false;
            void requestCompactSnapshot();
          } else {
            revisionRef.current = 0;
          }

          setStreamId(
            (current) =>
              current + 1
          );
        }
      );

    const offChunk =
      api?.onResponseChunk?.(
        (chunk) => {
          setStreaming(true);

          setText((current) => {
            return current + chunk;
          });
        }
      );

    const offEnd =
      api?.onResponseEnd?.(
        () => {
          setStreaming(false);
        }
      );

    const offClear =
      api?.onResponseClear?.(
        () => {
          setText("");
          setAgentStatus(null);
          setStreaming(false);
          hasIncrementalBase = false;
          revisionRef.current = 0;
        }
      );

    const offSide =
      api?.onResponseSideChange?.(
        setSide
      );

    return () => {
      disposed = true;
      offStatus?.();
      offSnapshot?.();
      offPatch?.();
      offText?.();
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
