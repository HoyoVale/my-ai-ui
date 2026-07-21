import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

const EMPTY_STATE = {
  currentConversationId: null,
  currentConversation: null,
  currentWorkspaceId: null,
  currentWorkspace: null,
  currentMode: "chat",
  currentModelSelection: null,
  currentModel: null,
  totalConversations: 0
};

export function useConversationHistory() {
  const [state, setState] =
    useState(EMPTY_STATE);
  const [conversations, setConversations] =
    useState([]);
  const [current, setCurrent] =
    useState(null);
  const [inspection, setInspection] =
    useState(null);
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
        const [
          nextState,
          nextConversations
        ] = await Promise.all([
          window.api
            ?.getConversationState?.(),
          window.api
            ?.listConversations?.()
        ]);

        const normalizedState =
          nextState ?? EMPTY_STATE;
        const normalizedList =
          Array.isArray(
            nextConversations
          )
            ? nextConversations
            : [];
        const conversationId =
          normalizedState
            .currentConversationId;

        const [detail, contextInspection] =
          conversationId
            ? await Promise.all([
                window.api
                  ?.getConversation?.(
                    conversationId
                  ),
                window.api
                  ?.inspectConversationContext?.(
                    conversationId
                  )
              ])
            : [null, null];

        if (
          sequence !==
          refreshSequence.current
        ) {
          return;
        }

        setState(normalizedState);
        setConversations(
          normalizedList
        );
        setCurrent(detail ?? null);
        setInspection(
          contextInspection ?? null
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
          "读取会话窗口数据失败：",
          refreshError
        );
        setError(
          "无法读取会话记录。"
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
        ?.onConversationChanged?.(
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
              "会话操作失败。"
            );
            return result;
          }

          await refresh();
          return result;
        } catch (actionError) {
          console.error(
            "会话操作失败：",
            actionError
          );
          setError(
            "会话操作失败。"
          );
          return {
            ok: false,
            message:
              "会话操作失败。"
          };
        } finally {
          setBusy(false);
        }
      },
      [refresh]
    );

  return {
    state,
    conversations,
    current,
    inspection,
    loading,
    busy,
    error,
    refresh,

    create: (input = {}) =>
      runAction(
        () =>
          window.api
            ?.createConversation?.(
              typeof input === "object" && input !== null
                ? input
                : { workspaceId: input }
            )
      ),

    switchWorkspace: (workspaceId = null) =>
      runAction(
        () =>
          window.api
            ?.switchConversationWorkspace?.(
              workspaceId
            )
      ),

    navigateContext: (input) =>
      runAction(
        () =>
          window.api
            ?.navigateConversationContext?.(input)
      ),

    setModel: (input) =>
      runAction(
        () =>
          window.api
            ?.setConversationModel?.(input)
      ),

    setGoal: (input) =>
      runAction(
        () =>
          window.api
            ?.setConversationGoal?.(input)
      ),

    select: (conversationId) =>
      runAction(
        () =>
          window.api
            ?.selectConversation?.(
              conversationId
            )
      ),

    rename: (input) =>
      runAction(
        () =>
          window.api
            ?.renameConversation?.(
              input
            )
      ),

    remove: (conversationId) =>
      runAction(
        () =>
          window.api
            ?.deleteConversation?.(
              conversationId
            )
      ),

    resetContext: (
      conversationId
    ) =>
      runAction(
        () =>
          window.api
            ?.resetConversationContext?.(
              conversationId
            )
      ),

    updateMessageContext: (
      input
    ) =>
      runAction(
        () =>
          window.api
            ?.updateMessageContext?.(
              input
            )
      ),

    regenerate: (
      input
    ) =>
      runAction(
        () =>
          window.api
            ?.regenerateConversationMessage?.(
              input
            )
      )
  };
}
