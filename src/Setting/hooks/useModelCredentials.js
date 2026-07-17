import {
  useCallback,
  useEffect,
  useState
} from "react";

const EMPTY_STATUS = {
  configured: false,
  source: "none",
  protected: false
};

export function useModelCredentials() {
  const [status, setStatus] =
    useState(
      EMPTY_STATUS
    );

  const [loading, setLoading] =
    useState(true);

  const refresh =
    useCallback(
      async () => {
        setLoading(true);

        try {
          const value =
            await window.api
              ?.getModelCredentialStatus?.();

          if (value) {
            setStatus(value);
          }
        } catch (error) {
          console.error(
            "读取模型凭据状态失败：",
            error
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveApiKey =
    useCallback(
      async (apiKey) => {
        const value =
          await window.api
            ?.setModelApiKey?.(
              apiKey
            );

        if (value) {
          setStatus(value);
        }

        return value;
      },
      []
    );

  const clearApiKey =
    useCallback(
      async () => {
        const value =
          await window.api
            ?.clearModelApiKey?.();

        if (value) {
          setStatus(value);
        }

        return value;
      },
      []
    );

  return {
    status,
    loading,
    refresh,
    saveApiKey,
    clearApiKey
  };
}
