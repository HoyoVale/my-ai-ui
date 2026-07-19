import {
  useCallback,
  useEffect,
  useMemo,
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

export function encodeModelOptionValue(
  providerId,
  modelConfigId
) {
  return JSON.stringify([
    String(providerId ?? ""),
    String(modelConfigId ?? "")
  ]);
}

export function parseModelOptionValue(value) {
  try {
    const parsed = JSON.parse(String(value ?? ""));

    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((item) => typeof item === "string" && item)
    ) {
      return {
        providerId: parsed[0],
        modelConfigId: parsed[1]
      };
    }
  } catch {
    // Invalid menu values are ignored.
  }

  return null;
}

export function flattenModels(settings) {
  const providers = Object.values(
    settings?.model?.providers ?? {}
  ).filter((provider) =>
    provider?.configured !== false
  );

  const activeProviderId = settings?.model?.activeProvider;

  return providers.flatMap((provider) =>
    (Array.isArray(provider.models) ? provider.models : [])
      .map((model) => ({
        value: encodeModelOptionValue(provider.id, model.id),
        providerId: provider.id,
        modelConfigId: model.id,
        label: model.name || model.modelId || model.id,
        providerLabel: provider.name || provider.id,
        active:
          provider.id === activeProviderId &&
          model.id === provider.activeModelId
      }))
  ).sort((left, right) =>
    Number(right.active) - Number(left.active)
  );
}

export function useInputContext(settings) {
  const [state, setState] = useState(EMPTY_STATE);
  const [workspaces, setWorkspaces] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const models = useMemo(
    () => flattenModels(settings),
    [settings]
  );

  const refresh = useCallback(async () => {
    try {
      let [nextState, nextWorkspaces, nextConversations] = await Promise.all([
        window.api?.getConversationState?.(),
        window.api?.listWorkspaces?.(),
        window.api?.listConversations?.()
      ]);

      if (!nextState?.currentConversationId) {
        await window.api?.navigateConversationContext?.({
          mode: "chat",
          workspaceId: null
        });
        [nextState, nextConversations] = await Promise.all([
          window.api?.getConversationState?.(),
          window.api?.listConversations?.()
        ]);
      }

      setState(nextState ?? EMPTY_STATE);
      setWorkspaces(
        Array.isArray(nextWorkspaces)
          ? nextWorkspaces.filter((workspace) => !workspace.missing)
          : []
      );
      setConversations(
        Array.isArray(nextConversations)
          ? nextConversations
          : []
      );
      setError("");
    } catch (refreshError) {
      console.error("读取输入上下文失败：", refreshError);
      setError("无法读取当前会话上下文。");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void refresh();

    const unsubscribe = window.api
      ?.onConversationChanged?.(() => {
        if (!disposed) {
          void refresh();
        }
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [refresh]);

  const runAction = useCallback(async (action) => {
    setBusy(true);
    setError("");

    try {
      const result = await action();

      if (result?.ok === false) {
        setError(result.message ?? "会话操作失败。");
        return result;
      }

      await refresh();
      return result;
    } catch (actionError) {
      console.error("输入上下文操作失败：", actionError);
      setError("会话操作失败。");
      return {
        ok: false,
        message: "会话操作失败。"
      };
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const addWorkspace = useCallback(() => runAction(async () => {
    const selected = await window.api
      ?.selectWorkspaceDirectory?.();

    if (selected?.canceled || !selected?.paths?.[0]) {
      return {
        ok: true,
        canceled: true
      };
    }

    return window.api?.registerWorkspace?.(
      selected.paths[0]
    );
  }), [runAction]);

  return {
    state,
    workspaces,
    conversations,
    models,
    busy,
    error,
    refresh,
    selectSession: (conversationId) => runAction(() =>
      window.api?.selectConversation?.(conversationId)
    ),
    createSession: ({
      mode,
      workspaceId,
      modelSelection
    }) => runAction(() =>
      window.api?.createConversation?.({
        mode,
        workspaceId,
        modelSelection
      })
    ),
    addWorkspace,
    setModel: (providerId, modelConfigId) => runAction(() =>
      window.api?.setConversationModel?.({
        conversationId: state.currentConversationId,
        providerId,
        modelConfigId
      })
    )
  };
}
