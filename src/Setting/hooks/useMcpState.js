import {
  useCallback,
  useEffect,
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

export function useMcpState() {
  const [state, setState] = useState(EMPTY_STATE);
  const [status, setStatus] = useState("loading");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await window.api?.getMcpState?.();
      if (next) {
        setState(next);
      }
      setStatus("ready");
      setError("");
      return next;
    } catch (cause) {
      setStatus("error");
      setError(String(cause?.message ?? cause ?? "读取 MCP 状态失败"));
      return null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void window.api?.getMcpState?.()
      .then((next) => {
        if (!disposed && next) {
          setState(next);
          setStatus("ready");
        }
      })
      .catch((cause) => {
        if (!disposed) {
          setStatus("error");
          setError(String(cause?.message ?? cause ?? "读取 MCP 状态失败"));
        }
      });

    const unsubscribe = window.api?.onMcpChanged?.((next) => {
      if (!disposed && next) {
        setState(next);
        setStatus("ready");
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const run = useCallback(async (key, callback) => {
    setAction(key);
    setError("");
    try {
      const result = await callback();
      if (result?.state) {
        setState(result.state);
      }
      return result;
    } catch (cause) {
      setError(String(cause?.message ?? cause ?? "MCP 操作失败"));
      return null;
    } finally {
      setAction("");
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
