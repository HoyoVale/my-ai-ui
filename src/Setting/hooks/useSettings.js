import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import {
  FALLBACK_SETTINGS
} from "../../shared/defaultSettings.js";

const SAVE_DELAY = 250;

function isMergeableObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function mergePatch(target, patch) {
  if (!isMergeableObject(patch)) {
    return patch;
  }

  const output = isMergeableObject(target)
    ? { ...target }
    : {};

  for (const [key, value] of Object.entries(patch)) {
    output[key] = isMergeableObject(value)
      ? mergePatch(output[key], value)
      : value;
  }

  return output;
}

function hasKeys(value) {
  return (
    isMergeableObject(value) &&
    Object.keys(value).length > 0
  );
}

export function useSettings() {
  const [settings, setSettings] = useState(FALLBACK_SETTINGS);
  const [status, setStatus] = useState("loading");

  const pendingPatchRef = useRef({});
  const saveTimerRef = useRef(null);
  const latestRequestRef = useRef(0);
  const remoteSnapshotRef = useRef(0);
  const activeRequestsRef = useRef(new Set());

  const hasLocalChanges = useCallback(() => (
    hasKeys(pendingPatchRef.current) ||
    activeRequestsRef.current.size > 0
  ), []);

  const applySnapshot = useCallback((value) => {
    if (!value) {
      return;
    }

    if (hasLocalChanges()) {
      return;
    }

    setSettings(value);
    setStatus("saved");
  }, [hasLocalChanges]);

  useEffect(() => {
    let disposed = false;

    const initialSnapshot =
      remoteSnapshotRef.current;

    window.api
      ?.getSettings?.()
      .then((value) => {
        if (
          !disposed &&
          initialSnapshot ===
            remoteSnapshotRef.current
        ) {
          applySnapshot(value);
        }
      })
      .catch((error) => {
        console.error(
          "读取设置失败：",
          error
        );

        if (
          !disposed &&
          initialSnapshot ===
            remoteSnapshotRef.current
        ) {
          setStatus("error");
        }
      });

    const unsubscribe =
      window.api
        ?.onSettingsChanged?.(
          (value) => {
            if (!disposed) {
              remoteSnapshotRef.current += 1;
              applySnapshot(value);
            }
          }
        );

    return () => {
      disposed = true;
      remoteSnapshotRef.current += 1;
      unsubscribe?.();
    };
  }, [applySnapshot]);

  const flushPending = useCallback(async () => {
    const patch = pendingPatchRef.current;

    if (!hasKeys(patch)) {
      return;
    }

    pendingPatchRef.current = {};
    saveTimerRef.current = null;

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    activeRequestsRef.current.add(requestId);

    try {
      const saved = await window.api
        ?.updateSettings?.(patch);

      activeRequestsRef.current.delete(requestId);

      if (
        requestId !== latestRequestRef.current ||
        !saved
      ) {
        return;
      }

      const base = saved;
      const pending = pendingPatchRef.current;

      setSettings(
        hasKeys(pending)
          ? mergePatch(base, pending)
          : base
      );

      setStatus(
        hasKeys(pending) ||
        activeRequestsRef.current.size > 0
          ? "saving"
          : "saved"
      );
    } catch (error) {
      activeRequestsRef.current.delete(requestId);

      console.error(
        "保存设置失败：",
        error
      );

      if (requestId !== latestRequestRef.current) {
        return;
      }

      setStatus("error");

      const latest = await window.api
        ?.getSettings?.()
        .catch(() => null);

      if (
        latest &&
        requestId === latestRequestRef.current
      ) {
        const pending = pendingPatchRef.current;
        setSettings(
          hasKeys(pending)
            ? mergePatch(latest, pending)
            : latest
        );
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      const patch = pendingPatchRef.current;

      if (hasKeys(patch)) {
        void window.api
          ?.updateSettings?.(patch);
      }
    };
  }, []);

  const updateSection = useCallback((section, patch) => {
    setStatus("saving");

    setSettings((current) => ({
      ...current,
      [section]: mergePatch(
        current[section],
        patch
      )
    }));

    pendingPatchRef.current = mergePatch(
      pendingPatchRef.current,
      {
        [section]: patch
      }
    );

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(
      flushPending,
      SAVE_DELAY
    );
  }, [flushPending]);

  const resetAll = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    pendingPatchRef.current = {};

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    activeRequestsRef.current.add(requestId);

    setStatus("saving");

    try {
      const reset = await window.api
        ?.resetSettings?.();

      activeRequestsRef.current.delete(requestId);

      if (
        requestId === latestRequestRef.current &&
        reset
      ) {
        setSettings(reset);
        setStatus("saved");
      }
    } catch (error) {
      activeRequestsRef.current.delete(requestId);

      console.error(
        "重置设置失败：",
        error
      );

      setStatus("error");
    }
  }, []);

  return {
    settings,
    status,
    updateSection,
    resetAll
  };
}
