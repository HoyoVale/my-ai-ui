import {
  useEffect,
  useMemo,
  useState
} from "react";

export function useToolManifest(toolSettings = {}) {
  const [manifest, setManifest] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const serializedSettings = JSON.stringify(toolSettings ?? {});
  const previewTools = useMemo(
    () => JSON.parse(serializedSettings),
    [serializedSettings]
  );

  useEffect(() => {
    let disposed = false;
    setStatus("loading");
    setError("");

    window.api?.getToolManifest?.({
      settingsPreview: {
        tools: previewTools
      }
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

    return () => {
      disposed = true;
    };
  }, [previewTools]);

  return {
    manifest,
    status,
    error
  };
}
