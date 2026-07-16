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

    window.api
      ?.isMaximized?.()
      .then((value) => {
        if (!disposed) {
          setIsMaximized(
            Boolean(value)
          );
        }
      })
      .catch((error) => {
        console.warn(
          "无法读取窗口最大化状态：",
          error
        );
      });

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
