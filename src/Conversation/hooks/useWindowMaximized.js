import {
  useEffect,
  useState
} from "react";

export function useWindowMaximized() {
  const [
    isMaximized,
    setIsMaximized
  ] = useState(false);

  useEffect(() => {
    let disposed = false;

    const request =
      window.api
        ?.isMaximized?.();

    request
      ?.then?.((value) => {
        if (!disposed) {
          setIsMaximized(
            Boolean(value)
          );
        }
      })
      .catch?.(() => {});

    const unsubscribe =
      window.api
        ?.onWindowStateChange?.(
          (value) => {
            if (!disposed) {
              setIsMaximized(
                Boolean(value)
              );
            }
          }
        );

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return isMaximized;
}
