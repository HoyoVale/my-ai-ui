import {
  appendResponseChunk,
  endResponseStream,
  startResponseStream
} from "../windows/response/index.js";

const DEMO_TEXT =
  "你好，我是模型返回的流式内容。"
  + "\n\n这个气泡会根据文字长度自动调整宽度，"
  + "达到最大宽度后自动换行。"
  + "\n\n当内容高度超过上限时，"
  + "内部会自动出现纵向滚动条。";

let demoTimer = null;

export function runResponseDemo() {
  if (demoTimer) {
    clearInterval(
      demoTimer
    );

    demoTimer = null;
  }

  startResponseStream();

  let index = 0;

  demoTimer = setInterval(
    () => {
      if (
        index >=
        DEMO_TEXT.length
      ) {
        clearInterval(
          demoTimer
        );

        demoTimer = null;

        endResponseStream();
        return;
      }

      appendResponseChunk(
        DEMO_TEXT[index]
      );

      index += 1;
    },
    35
  );
}
