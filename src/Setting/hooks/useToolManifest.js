import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

export function useToolManifest(settingsPreview = {}) {
  const [manifest, setManifest] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const contextSignatureRef = useRef("");
  const normalizedPreview = settingsPreview.tools
    ? settingsPreview
    : { tools: settingsPreview };
  const serializedSettings = JSON.stringify(normalizedPreview ?? {});
  const preview = useMemo(
    () => JSON.parse(serializedSettings),
    [serializedSettings]
  );

  useEffect(() => {
    let disposed = false;

    const refresh = () => {
      setStatus("loading");
      setError("");

      window.api?.getToolManifest?.({
        settingsPreview: preview
      })
        .then((value) => {
          if (disposed) return;
          setManifest(value ?? null);
          setStatus("ready");
        })
        .catch((caught) => {
          if (disposed) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setStatus("error");
        });
    };

    refresh();

    const contextSignature = (state) => JSON.stringify({
      id: state?.currentConversationId ?? null,
      mode: state?.currentMode ?? "chat",
      workspaceId: state?.currentWorkspaceId ?? null,
      modelSelection: state?.currentModelSelection ?? null
    });

    Promise.resolve(window.api?.getConversationState?.())
      .then((state) => {
        if (!disposed) {
          contextSignatureRef.current = contextSignature(state);
        }
      })
      .catch(() => {});

    const unsubscribe = window.api?.onConversationChanged?.((state) => {
      if (disposed) return;
      const nextSignature = contextSignature(state);
      if (!contextSignatureRef.current) {
        contextSignatureRef.current = nextSignature;
        return;
      }
      if (nextSignature !== contextSignatureRef.current) {
        contextSignatureRef.current = nextSignature;
        refresh();
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [preview]);

  return {
    manifest,
    status,
    error
  };
}
