import {
  useEffect,
  useState
} from "react";

export function useResponseStream() {
  const [text, setText] =
    useState("");

  const [streaming, setStreaming] =
    useState(false);

  const [side, setSide] =
    useState("right");

  const [streamId, setStreamId] =
    useState(0);

  useEffect(() => {
    const offStart =
      window.api?.onResponseStart?.(
        () => {
          setText("");
          setStreaming(true);

          setStreamId(
            (current) =>
              current + 1
          );
        }
      );

    const offChunk =
      window.api?.onResponseChunk?.(
        (chunk) => {
          setStreaming(true);

          setText((current) => {
            return current + chunk;
          });
        }
      );

    const offEnd =
      window.api?.onResponseEnd?.(
        () => {
          setStreaming(false);
        }
      );

    const offClear =
      window.api?.onResponseClear?.(
        () => {
          setText("");
          setStreaming(false);
        }
      );

    const offSide =
      window.api
        ?.onResponseSideChange?.(
          setSide
        );

    return () => {
      offStart?.();
      offChunk?.();
      offEnd?.();
      offClear?.();
      offSide?.();
    };
  }, []);

  return {
    text,
    streaming,
    side,
    streamId
  };
}
