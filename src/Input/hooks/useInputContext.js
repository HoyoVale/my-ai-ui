import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  normalizeSessionMode
} from "../../shared/sessionNavigation.js";

const EMPTY_STATE = {
  currentConversationId: null,
  currentConversation: null,
  currentWorkspaceId: null,
  currentWorkspace: null,
  currentMode: "chat",
  currentModelSelection: null,
  currentModel: null,
  currentSkillId: null,
  currentSkill: null,
  currentSkillIds: [],
  currentSkills: [],
  currentSkillRoutingMode: "manual",
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

async function readConversationContext() {
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

  return {
    state: nextState ?? EMPTY_STATE,
    workspaces: Array.isArray(nextWorkspaces)
      ? nextWorkspaces.filter((workspace) => !workspace.missing)
      : [],
    conversations: Array.isArray(nextConversations)
      ? nextConversations
      : []
  };
}

export function useInputContext(settings) {
  const [state, setState] = useState(EMPTY_STATE);
  const [workspaces, setWorkspaces] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [skills, setSkills] = useState([]);
  const [skillsReady, setSkillsReady] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const models = useMemo(
    () => flattenModels(settings),
    [settings]
  );

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const context = await readConversationContext();
      const mode = normalizeSessionMode(context.state.currentMode, "chat");

      let nextSkills = [];
      let nextSkillsError = "";
      try {
        const runtimeState = await window.api?.getSkillRuntimeState?.(mode);
        nextSkills = Array.isArray(runtimeState?.skills)
          ? runtimeState.skills
          : [];
      } catch (skillError) {
        console.warn("读取 Skill Runtime 状态失败：", skillError);
        nextSkillsError = "无法读取 Skill 列表。";
      }

      if (sequence !== refreshSequence.current) return null;
      setState(context.state);
      setWorkspaces(context.workspaces);
      setConversations(context.conversations);
      setSkills(nextSkills);
      setSkillsReady(true);
      setSkillsError(nextSkillsError);
      setError("");
      return context.state;
    } catch (refreshError) {
      if (sequence === refreshSequence.current) {
        console.error("读取输入上下文失败：", refreshError);
        setSkillsReady(true);
        setError("无法读取当前会话上下文。");
      }
      return null;
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
    const unsubscribeSkills = window.api
      ?.onSkillsChanged?.(() => {
        if (!disposed) {
          void refresh();
        }
      });

    return () => {
      disposed = true;
      refreshSequence.current += 1;
      unsubscribe?.();
      unsubscribeSkills?.();
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
    skills,
    skillsReady,
    skillsError,
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
      modelSelection,
      skillId,
      skillIds,
      skillRoutingMode
    }) => runAction(() =>
      window.api?.createConversation?.({
        mode,
        workspaceId,
        modelSelection,
        skillId,
        skillIds,
        skillRoutingMode
      })
    ),
    addWorkspace,
    setModel: (providerId, modelConfigId) => runAction(() =>
      window.api?.setConversationModel?.({
        conversationId: state.currentConversationId,
        providerId,
        modelConfigId
      })
    ),
    setSkill: (selection) => runAction(() => {
      const skillIds = Array.isArray(selection?.skillIds)
        ? selection.skillIds
        : selection == null
          ? []
          : [selection];
      return window.api?.setConversationSkill?.({
        conversationId: state.currentConversationId,
        skillIds,
        skillRoutingMode: selection?.skillRoutingMode ?? state.currentSkillRoutingMode
      });
    }),
    setGoal: ({ objective = "", status = "active" } = {}) => runAction(() =>
      window.api?.setConversationGoal?.({
        conversationId: state.currentConversationId,
        objective,
        status
      })
    )
  };
}
