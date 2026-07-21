import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

const EMPTY_STATE = {
  schemaVersion: 1,
  revision: 0,
  total: 0,
  enabled: 0,
  disabled: 0,
  available: 0,
  unavailable: 0,
  invalid: 0,
  skills: []
};

export function useSkills(developerMode = false) {
  const [state, setState] = useState(EMPTY_STATE);
  const [status, setStatus] = useState("loading");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestSequence = useRef(0);

  const applyState = useCallback((next, sequence = requestSequence.current) => {
    if (!next || sequence !== requestSequence.current) return false;
    setState((current) =>
      Number(next.revision ?? 0) < Number(current.revision ?? 0)
        ? current
        : next
    );
    setStatus("ready");
    return true;
  }, []);

  const refresh = useCallback(async ({ loading = true } = {}) => {
    const sequence = ++requestSequence.current;
    if (loading) setStatus("loading");
    try {
      const next = await window.api?.getSkillState?.();
      if (applyState(next, sequence)) setError("");
      return next;
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setStatus("error");
        setError(String(cause?.message ?? cause ?? "读取 Skill 状态失败"));
      }
      return null;
    }
  }, [applyState]);

  useEffect(() => {
    let disposed = false;
    void refresh();

    const unsubscribe = window.api?.onSkillsChanged?.((next) => {
      if (disposed || !next) return;
      const sequence = ++requestSequence.current;
      if (developerMode) {
        void window.api?.getSkillState?.()
          .then((detailed) => {
            if (!disposed) applyState(detailed, sequence);
          })
          .catch((cause) => {
            if (!disposed && sequence === requestSequence.current) {
              setStatus("error");
              setError(String(cause?.message ?? cause ?? "读取 Skill 状态失败"));
            }
          });
        return;
      }
      applyState(next, sequence);
    });

    return () => {
      disposed = true;
      requestSequence.current += 1;
      unsubscribe?.();
    };
  }, [applyState, developerMode, refresh]);

  const run = useCallback(async (key, callback, successMessage = "") => {
    setAction(key);
    setError("");
    setMessage("");
    try {
      const result = await callback();
      if (result?.state) {
        const sequence = ++requestSequence.current;
        applyState(result.state, sequence);
      }
      if (result?.canceled) return result;
      if (!result?.ok) {
        setError(result?.message ?? "Skill 操作失败");
        return result;
      }
      setMessage(successMessage || result?.message || "操作完成");
      return result;
    } catch (cause) {
      setError(String(cause?.message ?? cause ?? "Skill 操作失败"));
      return null;
    } finally {
      setAction("");
    }
  }, [applyState]);

  return {
    state,
    status,
    action,
    error,
    message,
    refresh,
    run,
    clearFeedback: () => {
      setError("");
      setMessage("");
    }
  };
}
