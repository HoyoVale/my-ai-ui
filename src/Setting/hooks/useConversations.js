import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

const EMPTY_STATE = {
  currentConversationId: null,
  currentConversation: null,
  totalConversations: 0
};

export function useConversations() {
  const [state, setState] =
    useState(
      EMPTY_STATE
    );

  const [conversations, setConversations] =
    useState([]);

  const [status, setStatus] =
    useState("loading");

  const [error, setError] =
    useState("");
  const refreshSequence =
    useRef(0);

  const refresh =
    useCallback(
      async () => {
        const sequence =
          ++refreshSequence.current;

        try {
          const [
            nextState,
            nextConversations
          ] =
            await Promise.all([
              window.api
                ?.getConversationState?.(),

              window.api
                ?.listConversations?.()
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

          setConversations(
            Array.isArray(
              nextConversations
            )
              ? nextConversations
              : []
          );

          setError("");
          setStatus("ready");
        } catch (refreshError) {
          if (
            sequence !==
            refreshSequence.current
          ) {
            return;
          }

          console.error(
            "读取会话失败：",
            refreshError
          );

          setError(
            "无法读取会话数据。"
          );

          setStatus("error");
        }
      },
      []
    );

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
        setStatus("working");

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

            setStatus("error");
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

          setStatus("error");

          return {
            ok: false,
            message:
              "会话操作失败。"
          };
        }
      },
      [refresh]
    );

  return {
    state,
    conversations,
    status,
    error,
    refresh,

    create: () =>
      runAction(
        () =>
          window.api
            ?.createConversation?.()
      ),

    select: (
      conversationId
    ) =>
      runAction(
        () =>
          window.api
            ?.selectConversation?.(
              conversationId
            )
      ),

    remove: (
      conversationId
    ) =>
      runAction(
        () =>
          window.api
            ?.deleteConversation?.(
              conversationId
            )
      ),

    clear: () =>
      runAction(
        () =>
          window.api
            ?.clearConversations?.()
      )
  };
}
