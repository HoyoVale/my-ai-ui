import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  const requestSequence =
    useRef(0);

  const refresh = useCallback(
    async () => {
      const sequence =
        ++requestSequence.current;

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

        if (
          value &&
          sequence === requestSequence.current
        ) {
          setStatus(value);
        }
      } catch (error) {
        if (
          sequence !== requestSequence.current
        ) {
          return;
        }

        console.error(
          "读取模型凭据状态失败：",
          error
        );
      } finally {
        if (
          sequence === requestSequence.current
        ) {
          setLoading(false);
        }
      }
    },
    [descriptor]
  );

  useEffect(() => {
    setStatus(EMPTY_STATUS);
    void refresh();

    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  const saveApiKey = useCallback(
    async (apiKey) => {
      const sequence =
        ++requestSequence.current;
      const value =
        await window.api
          ?.setModelApiKey?.({
            ...descriptor,
            apiKey
          });

      if (
        value &&
        sequence === requestSequence.current
      ) {
        setStatus(value);
      }

      return value;
    },
    [descriptor]
  );

  const clearApiKey = useCallback(
    async () => {
      const sequence =
        ++requestSequence.current;
      const value =
        await window.api
          ?.clearModelApiKey?.(
            descriptor
          );

      if (
        value &&
        sequence === requestSequence.current
      ) {
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
