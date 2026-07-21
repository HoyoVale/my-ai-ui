function textValue(value) {
  return String(value ?? "");
}

export function hasResponseActivity(
  snapshot
) {
  if (!snapshot) {
    return false;
  }

  const hasVisibleEvents =
    Array.isArray(snapshot.events) &&
    snapshot.events.some((event) =>
      [
        "commentary",
        "tool"
      ].includes(event?.type)
    );

  return (
    hasVisibleEvents ||
    Number(
      snapshot.planStats?.total ?? 0
    ) > 0
  );
}

export function resolveResponsePresentation({
  text,
  finalText,
  liveStepText,
  liveStepRole = "none",
  hasActivity,
  streaming
}) {
  const streamText =
    textValue(text);

  const finalAnswer =
    textValue(finalText).trim();

  const currentStep =
    textValue(liveStepText);

  if (!hasActivity) {
    return {
      answerText:
        finalAnswer ||
        currentStep ||
        streamText,
      liveText: ""
    };
  }

  if (finalAnswer) {
    return {
      answerText: finalAnswer,
      liveText: ""
    };
  }

  if (
    streaming &&
    currentStep &&
    liveStepRole === "final_candidate"
  ) {
    return {
      answerText: currentStep,
      liveText: ""
    };
  }

  if (streaming) {
    return {
      answerText: "",
      /*
       * 结构化状态和文本 chunk 来自两个 IPC 通道，不能假定状态快照
       * 一定先到。若 liveStepText 暂时为空，仍用已收到的文本流兜底，
       * 避免工具流存在时 Response 只显示活动面板而看不到模型文字。
       */
      liveText:
        currentStep ||
        streamText
    };
  }

  return {
    /*
     * 正常结束时应由 finalText 提供最终回复；这里保留传统文本流兜底，
     * 防止最终结构化快照丢失或晚到时整条回复变成空白。
     */
    answerText:
      currentStep ||
      streamText,
    liveText: ""
  };
}
