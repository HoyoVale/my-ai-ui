import {
  useCallback,
  useEffect,
  useState
} from "react";

export function useUpdateState() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;

    window.api
      ?.getUpdateState?.()
      .then((value) => {
        if (!disposed) {
          setState(value);
        }
      })
      .catch((error) => {
        console.warn(
          "读取更新状态失败：",
          error
        );
      });

    const unsubscribe =
      window.api
        ?.onUpdateStateChanged?.(
          (value) => {
            if (!disposed) {
              setState(value);
            }
          }
        );

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const run = useCallback(
    async (action) => {
      if (!action || busy) {
        return null;
      }

      setBusy(true);
      try {
        const result = await action();
        if (result?.state) {
          setState(result.state);
        }
        return result;
      } catch (error) {
        console.warn(
          "更新操作失败：",
          error
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  return {
    state,
    busy,
    check: () => run(
      window.api?.checkForUpdates
    ),
    download: () => run(
      window.api?.downloadUpdate
    ),
    install: () => run(
      window.api?.installUpdate
    )
  };
}
