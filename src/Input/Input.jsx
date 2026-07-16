import { useRef, useState } from "react";

import { InputComposer } from "./components/Composer.jsx";
import { useInputWindowResize } from "./hooks/useInputWindowResize.js";
import "./Input.css";

export default function Input() {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  useInputWindowResize({
    value,
    textareaRef
  });

  const handleSend = () => {
    const message = value.trim();

    if (!message) {
      return;
    }

    // TODO: 后续在这里调用模型请求 IPC。
    console.log("Send message:", message);

    setValue("");
  };

  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent?.isComposing
    ) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <InputComposer
      textareaRef={textareaRef}
      value={value}
      canSend={Boolean(value.trim())}
      onChange={setValue}
      onKeyDown={handleKeyDown}
      onSend={handleSend}
      onClose={() => {
        window.api?.closeWindow?.();
      }}
    />
  );
}
