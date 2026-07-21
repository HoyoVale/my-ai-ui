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

export function useMemoryLibrary() {
  const [state, setState] =
    useState(EMPTY_STATE);
  const [memories, setMemories] =
    useState([]);
  const [loading, setLoading] =
    useState(true);
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
        const [nextState, nextMemories] =
          await Promise.all([
            window.api
              ?.getMemoryState?.(),
            window.api
              ?.listMemories?.()
          ]);

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
        setMemories(
          Array.isArray(
            nextMemories
          )
            ? nextMemories
            : []
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
          "读取记忆数据失败：",
          refreshError
        );
        setError(
          "无法读取长期记忆。"
        );
      } finally {
        if (
          sequence ===
          refreshSequence.current
        ) {
          setLoading(false);
        }
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

  const runAction =
    useCallback(
      async (action) => {
        setBusy(true);

        try {
          const result =
            await action();

          if (
            result &&
            result.ok === false
          ) {
            setError(
              result.message ??
              "记忆操作失败。"
            );
            return result;
          }

          await refresh();
          return result;
        } catch (actionError) {
          console.error(
            "记忆操作失败：",
            actionError
          );
          setError(
            "记忆操作失败。"
          );
          return {
            ok: false,
            message:
              "记忆操作失败。"
          };
        } finally {
          setBusy(false);
        }
      },
      [refresh]
    );

  return {
    state,
    memories,
    loading,
    busy,
    error,
    refresh,
    clearError: () => {
      setError("");
    },
    create: (input) =>
      runAction(
        () =>
          window.api
            ?.createMemory?.(
              input
            )
      ),
    update: (id, patch) =>
      runAction(
        () =>
          window.api
            ?.updateMemory?.(
              id,
              patch
            )
      ),
    remove: (id) =>
      runAction(
        () =>
          window.api
            ?.deleteMemory?.(
              id
            )
      ),
    clear: () =>
      runAction(
        () =>
          window.api
            ?.clearMemories?.()
      )
  };
}
