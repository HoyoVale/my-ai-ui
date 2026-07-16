import {
  useEffect,
  useState
} from "react";

export function useResolvedTheme(
  selectedTheme
) {
  const [
    systemDark,
    setSystemDark
  ] = useState(() => {
    return (
      window.matchMedia
        ?.(
          "(prefers-color-scheme: dark)"
        )
        ?.matches ??
      false
    );
  });

  useEffect(() => {
    const media =
      window.matchMedia?.(
        "(prefers-color-scheme: dark)"
      );

    if (!media) {
      return undefined;
    }

    const handleChange =
      (event) => {
        setSystemDark(
          event.matches
        );
      };

    media.addEventListener?.(
      "change",
      handleChange
    );

    return () => {
      media.removeEventListener?.(
        "change",
        handleChange
      );
    };
  }, []);

  if (
    selectedTheme === "dark"
  ) {
    return "dark";
  }

  if (
    selectedTheme === "light"
  ) {
    return "light";
  }

  return systemDark
    ? "dark"
    : "light";
}
