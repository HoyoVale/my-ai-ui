export function isExpectedSkillSubscriberDisconnect(error) {
  return /renderer closed|object has been destroyed|render frame was disposed|webcontents.*destroyed/iu.test(
    String(error?.message ?? error ?? "")
  );
}

export function reportSkillNotifyError(
  error,
  { warn = console.warn } = {}
) {
  if (isExpectedSkillSubscriberDisconnect(error)) {
    return { ignored: true, reported: false };
  }

  warn("广播 Skill 状态失败：", error);
  return { ignored: false, reported: true };
}
