import {
  useCallback,
  useEffect,
  useState
} from "react";

const EMPTY_STATE = {
  schemaVersion: 1,
  total: 0,
  enabled: 0,
  disabled: 0,
  invalid: 0,
  skills: []
};

export function useSkills(developerMode = false) {
  const [state, setState] = useState(EMPTY_STATE);
  const [status, setStatus] = useState("loading");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await window.api?.getSkillState?.();
      if (next) setState(next);
      setStatus("ready");
      setError("");
      return next;
    } catch (cause) {
      setStatus("error");
      setError(String(cause?.message ?? cause ?? "读取 Skill 状态失败"));
      return null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void window.api?.getSkillState?.()
      .then((next) => {
        if (!disposed && next) {
          setState(next);
          setStatus("ready");
        }
      })
      .catch((cause) => {
        if (!disposed) {
          setStatus("error");
          setError(String(cause?.message ?? cause ?? "读取 Skill 状态失败"));
        }
      });

    const unsubscribe = window.api?.onSkillsChanged?.((next) => {
      if (disposed || !next) return;
      if (developerMode) {
        void window.api?.getSkillState?.().then((detailed) => {
          if (!disposed && detailed) {
            setState(detailed);
            setStatus("ready");
          }
        });
        return;
      }
      setState(next);
      setStatus("ready");
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [developerMode]);

  const run = useCallback(async (key, callback, successMessage = "") => {
    setAction(key);
    setError("");
    setMessage("");
    try {
      const result = await callback();
      if (result?.state) setState(result.state);
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
  }, []);

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
