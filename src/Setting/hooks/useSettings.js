import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import {
  FALLBACK_SETTINGS
} from "../../shared/defaultSettings.js";

const SAVE_DELAY = 120;

function hasKeys(value) {
  return (
    value &&
    Object.keys(value).length > 0
  );
}

export function useSettings() {
  const [
    settings,
    setSettings
  ] = useState(
    FALLBACK_SETTINGS
  );

  const [
    status,
    setStatus
  ] = useState("loading");

  const pendingPatchRef =
    useRef({});

  const saveTimerRef =
    useRef(null);

  const latestRequestRef =
    useRef(0);

  useEffect(() => {
    let disposed = false;

    window.api
      ?.getSettings?.()
      .then((value) => {
        if (
          disposed ||
          !value
        ) {
          return;
        }

        setSettings(value);
        setStatus("saved");
      })
      .catch((error) => {
        console.error(
          "读取设置失败：",
          error
        );

        if (!disposed) {
          setStatus("error");
        }
      });

    const unsubscribe =
      window.api
        ?.onSettingsChanged?.(
          (value) => {
            if (
              !disposed &&
              value
            ) {
              setSettings(value);
              setStatus("saved");
            }
          }
        );

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const flushPending =
    useCallback(
      async () => {
        const patch =
          pendingPatchRef.current;

        if (!hasKeys(patch)) {
          return;
        }

        pendingPatchRef.current =
          {};

        saveTimerRef.current =
          null;

        const requestId =
          latestRequestRef.current +
          1;

        latestRequestRef.current =
          requestId;

        try {
          const saved =
            await window.api
              ?.updateSettings?.(
                patch
              );

          if (
            requestId ===
              latestRequestRef.current &&
            saved
          ) {
            setSettings(saved);
            setStatus("saved");
          }
        } catch (error) {
          console.error(
            "保存设置失败：",
            error
          );

          setStatus("error");

          const latest =
            await window.api
              ?.getSettings?.()
              .catch(
                () => null
              );

          if (latest) {
            setSettings(latest);
          }
        }
      },
      []
    );

  useEffect(() => {
    return () => {
      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current
        );
      }

      const patch =
        pendingPatchRef.current;

      if (hasKeys(patch)) {
        void window.api
          ?.updateSettings?.(
            patch
          );
      }
    };
  }, []);

  const updateSection =
    useCallback(
      (
        section,
        patch
      ) => {
        setStatus("saving");

        setSettings(
          (current) => ({
            ...current,

            [section]: {
              ...current[section],
              ...patch
            }
          })
        );

        pendingPatchRef.current = {
          ...pendingPatchRef.current,

          [section]: {
            ...pendingPatchRef
              .current[section],

            ...patch
          }
        };

        if (
          saveTimerRef.current
        ) {
          clearTimeout(
            saveTimerRef.current
          );
        }

        saveTimerRef.current =
          setTimeout(
            flushPending,
            SAVE_DELAY
          );
      },
      [flushPending]
    );

  const resetAll =
    useCallback(
      async () => {
        if (
          saveTimerRef.current
        ) {
          clearTimeout(
            saveTimerRef.current
          );

          saveTimerRef.current =
            null;
        }

        pendingPatchRef.current =
          {};

        const requestId =
          latestRequestRef.current +
          1;

        latestRequestRef.current =
          requestId;

        setStatus("saving");

        try {
          const reset =
            await window.api
              ?.resetSettings?.();

          if (
            requestId ===
              latestRequestRef.current &&
            reset
          ) {
            setSettings(reset);
            setStatus("saved");
          }
        } catch (error) {
          console.error(
            "重置设置失败：",
            error
          );

          setStatus("error");
        }
      },
      []
    );

  return {
    settings,
    status,
    updateSection,
    resetAll
  };
}
