import {
  useEffect,
  useState
} from "react";

export function useAppInfo() {
  const [
    appInfo,
    setAppInfo
  ] = useState(null);

  useEffect(() => {
    let disposed = false;

    window.api
      ?.getAppInfo?.()
      .then((value) => {
        if (!disposed) {
          setAppInfo(value);
        }
      })
      .catch((error) => {
        console.warn(
          "读取应用信息失败：",
          error
        );
      });

    return () => {
      disposed = true;
    };
  }, []);

  return appInfo;
}
