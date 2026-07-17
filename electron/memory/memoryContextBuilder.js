export function buildMemoryContext(
  memories
) {
  if (
    !Array.isArray(memories) ||
    memories.length === 0
  ) {
    return "";
  }

  const lines =
    memories.map(
      (memory) => {
        const title =
          String(
            memory.title ?? ""
          ).trim();

        const content =
          String(
            memory.content ?? ""
          ).trim();

        const body =
          title &&
          title !== content
            ? `${title}：${content}`
            : content;

        return `- ${body}`;
      }
    );

  return [
    "以下是用户明确保存并允许使用的长期记忆。仅在与当前问题相关时自然使用；不要声称这些信息来自本轮对话，也不要主动暴露记忆系统细节。",
    ...lines
  ].join("\n");
}
