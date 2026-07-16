import {
  useEffect,
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

  useEffect(() => {
    let disposed = false;

    window.api
      ?.getSettings?.()
      .then((value) => {
        if (
          !disposed &&
          value
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
              setSettings(value);
            }
          }
        );

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return settings;
}
