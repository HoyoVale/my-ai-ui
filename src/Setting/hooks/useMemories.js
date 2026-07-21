import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

const EMPTY_STATE = {
  totalMemories: 0,
  enabledMemories: 0,
  disabledMemories: 0
};

export function useMemories() {
  const [state, setState] =
    useState(EMPTY_STATE);
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState("");
  const refreshSequence =
    useRef(0);

  const refresh =
    useCallback(async () => {
      const sequence =
        ++refreshSequence.current;

      try {
        const nextState =
          await window.api
            ?.getMemoryState?.();

        if (
          sequence !==
          refreshSequence.current
        ) {
          return;
        }

        setState(
          nextState ??
          EMPTY_STATE
        );
        setError("");
      } catch (refreshError) {
        if (
          sequence !==
          refreshSequence.current
        ) {
          return;
        }

        console.error(
          "读取记忆状态失败：",
          refreshError
        );
        setError(
          "无法读取记忆状态。"
        );
      }
    }, []);

  useEffect(() => {
    let disposed = false;

    void refresh();

    const unsubscribe =
      window.api
        ?.onMemoryChanged?.(
          () => {
            if (!disposed) {
              void refresh();
            }
          }
        );

    return () => {
      disposed = true;
      refreshSequence.current += 1;
      unsubscribe?.();
    };
  }, [refresh]);

  const clear =
    useCallback(async () => {
      setBusy(true);

      try {
        const result =
          await window.api
            ?.clearMemories?.();

        if (
          result &&
          result.ok === false
        ) {
          setError(
            result.message ??
            "清空记忆失败。"
          );
          return result;
        }

        await refresh();
        return result;
      } catch (clearError) {
        console.error(
          "清空记忆失败：",
          clearError
        );
        setError(
          "清空记忆失败。"
        );
        return {
          ok: false
        };
      } finally {
        setBusy(false);
      }
    }, [refresh]);

  return {
    state,
    busy,
    error,
    clear
  };
}
