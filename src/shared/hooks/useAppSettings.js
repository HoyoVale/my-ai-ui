import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  FALLBACK_SETTINGS
} from "../defaultSettings.js";

export function useAppSettings() {
  const [
    settings,
    setSettings
  ] = useState(
    FALLBACK_SETTINGS
  );
  const remoteSequence =
    useRef(0);

  useEffect(() => {
    let disposed = false;

    const initialSequence =
      remoteSequence.current;

    window.api
      ?.getSettings?.()
      .then((value) => {
        if (
          !disposed &&
          value &&
          initialSequence ===
            remoteSequence.current
        ) {
          setSettings(value);
        }
      })
      .catch((error) => {
        console.warn(
          "读取应用设置失败：",
          error
        );
      });

    const unsubscribe =
      window.api
        ?.onSettingsChanged?.(
          (value) => {
            if (
              !disposed &&
              value
            ) {
              remoteSequence.current += 1;
              setSettings(value);
            }
          }
        );

    return () => {
      disposed = true;
      remoteSequence.current += 1;
      unsubscribe?.();
    };
  }, []);

  return settings;
}
