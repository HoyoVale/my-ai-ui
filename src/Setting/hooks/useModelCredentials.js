import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

const EMPTY_STATUS = {
  providerId: "",
  configured: false,
  source: "none",
  protected: false,
  environmentKey: ""
};

export function useModelCredentials(
  provider
) {
  const descriptor = useMemo(
    () => ({
      providerId:
        provider?.id ?? "",
      environmentKey:
        provider?.environmentKey ?? ""
    }),
    [
      provider?.environmentKey,
      provider?.id
    ]
  );

  const [status, setStatus] =
    useState(EMPTY_STATUS);

  const [loading, setLoading] =
    useState(true);

  const refresh = useCallback(
    async () => {
      if (!descriptor.providerId) {
        setStatus(EMPTY_STATUS);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const value =
          await window.api
            ?.getModelCredentialStatus?.(
              descriptor
            );

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
    [descriptor]
  );

  useEffect(() => {
    setStatus(EMPTY_STATUS);
    void refresh();
  }, [refresh]);

  const saveApiKey = useCallback(
    async (apiKey) => {
      const value =
        await window.api
          ?.setModelApiKey?.({
            ...descriptor,
            apiKey
          });

      if (value) {
        setStatus(value);
      }

      return value;
    },
    [descriptor]
  );

  const clearApiKey = useCallback(
    async () => {
      const value =
        await window.api
          ?.clearModelApiKey?.(
            descriptor
          );

      if (value) {
        setStatus(value);
      }

      return value;
    },
    [descriptor]
  );

  return {
    status,
    loading,
    refresh,
    saveApiKey,
    clearApiKey
  };
}
