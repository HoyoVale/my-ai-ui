import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

const EMPTY_STATE = {
  enabled: true,
  autoConnect: true,
  serverCount: 0,
  connectedCount: 0,
  toolCount: 0,
  servers: []
};

export function useMcpState(developerMode = false) {
  const [state, setState] = useState(EMPTY_STATE);
  const [status, setStatus] = useState("loading");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const actionSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setStatus("loading");
    try {
      const next = await window.api?.getMcpState?.();
      if (sequence !== requestSequence.current) return null;
      if (next) {
        setState(next);
      }
      setStatus("ready");
      setError("");
      return next;
    } catch (cause) {
      if (sequence !== requestSequence.current) return null;
      setStatus("error");
      setError(String(cause?.message ?? cause ?? "读取 MCP 状态失败"));
      return null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const sequence = ++requestSequence.current;
    void window.api?.getMcpState?.()
      .then((next) => {
        if (!disposed && sequence === requestSequence.current && next) {
          setState(next);
          setStatus("ready");
        }
      })
      .catch((cause) => {
        if (!disposed && sequence === requestSequence.current) {
          setStatus("error");
          setError(String(cause?.message ?? cause ?? "读取 MCP 状态失败"));
        }
      });

    const unsubscribe = window.api?.onMcpChanged?.((next) => {
      if (!disposed && next) {
        requestSequence.current += 1;
        setState(next);
        setStatus("ready");
      }
    });

    return () => {
      disposed = true;
      requestSequence.current += 1;
      unsubscribe?.();
    };
  }, [developerMode]);

  const run = useCallback(async (key, callback) => {
    const sequence = ++actionSequence.current;
    const stateSequence = requestSequence.current;
    setAction(key);
    setError("");
    try {
      const result = await callback();
      if (
        sequence === actionSequence.current &&
        stateSequence === requestSequence.current &&
        result?.state
      ) {
        setState(result.state);
      }
      return result;
    } catch (cause) {
      if (sequence !== actionSequence.current) return null;
      setError(String(cause?.message ?? cause ?? "MCP 操作失败"));
      return null;
    } finally {
      if (sequence === actionSequence.current) {
        setAction("");
      }
    }
  }, []);

  return {
    state,
    status,
    action,
    error,
    refresh,
    run,
    clearError: () => setError("")
  };
}
