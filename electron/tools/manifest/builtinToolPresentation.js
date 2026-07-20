export const BUILTIN_TOOLSET_MANIFEST = Object.freeze([
  {
    id: "core.runtime",
    title: "时间与运行环境",
    description: "提供当前时间、时区、日期计算、精确计算和运行状态。",
    riskLabel: "安全",
    userVisible: true,
    order: 10
  },
  {
    id: "workspace.read",
    title: "工作区只读",
    description: "在授权目录中浏览、读取和搜索文件，不允许修改。",
    riskLabel: "只读",
    userVisible: true,
    order: 20
  },
  {
    id: "workspace.write",
    title: "工作区写入",
    description: "仅在 Coding 模式中使用原子写入修改授权工作区内的文本文件。",
    riskLabel: "本地写入",
    userVisible: true,
    order: 30
  },
  {
    id: "workspace.exec",
    title: "工作区进程",
    description: "通过受监管的子进程运行只读 Git 检查或显式允许的工作区命令。",
    riskLabel: "高风险",
    userVisible: false,
    order: 40
  },
  {
    id: "agent.internal",
    title: "Agent 内部",
    description: "维护任务计划、进度和大型结果引用。",
    riskLabel: "内部",
    userVisible: false,
    order: 50
  }
]);

export const BUILTIN_TOOL_PRESENTATION = Object.freeze({
  get_current_time: {
    toolset: "core.runtime",
    title: "获取当前时间",
    description: "读取本机当前时间、UTC 时间、IANA 时区与 UTC 偏移。"
  },
  convert_time_zone: {
    toolset: "core.runtime",
    title: "换算时区",
    description: "在不同 IANA 时区之间换算日期和时间。"
  },
  calculate_date: {
    toolset: "core.runtime",
    title: "计算日期",
    description: "进行日期加减、日期差、星期和 ISO 时间计算。"
  },
  calculator: {
    toolset: "core.runtime",
    title: "计算器",
    description: "使用受限表达式解析器完成精确数学计算，不执行任意代码。"
  },
  get_runtime_info: {
    toolset: "core.runtime",
    title: "读取运行环境",
    description: "读取经过净化的系统、应用、模型和工具运行信息。"
  },
  get_agent_status: {
    toolset: "core.runtime",
    title: "读取 Agent 状态",
    description: "读取当前 Agent Run、模型和精简计划状态，不返回原始工具记录。"
  },
  get_workspace_info: {
    toolset: "workspace.read",
    title: "查看工作区",
    description: "查看当前授权目录、路径别名和固定安全限制。"
  },
  list_directory: {
    toolset: "workspace.read",
    title: "列出目录",
    description: "列出授权目录中的安全文件和子目录。"
  },
  stat_path: {
    toolset: "workspace.read",
    title: "查看路径信息",
    description: "读取路径类型、文件大小和最后修改时间。"
  },
  read_text_file: {
    toolset: "workspace.read",
    title: "读取文本文件",
    description: "按行读取授权工作区内受限大小的安全 UTF-8 文本文件。"
  },
  search_files: {
    toolset: "workspace.read",
    title: "搜索文件",
    description: "使用有界 Glob 在授权工作区中搜索文件名。"
  },
  search_text: {
    toolset: "workspace.read",
    title: "搜索文本",
    description: "在安全文本文件中搜索字面文本和代码片段。"
  },
  detect_project: {
    toolset: "workspace.read",
    title: "识别项目",
    description: "通过项目清单识别语言、包管理器、构建系统和脚本。"
  },
  compute_file_hash: {
    toolset: "workspace.read",
    title: "计算文件哈希",
    description: "为授权工作区中的安全文件流式计算 SHA-256。"
  },
  write_text_file: {
    toolset: "workspace.write",
    title: "原子写入文本文件",
    description: "通过临时文件、fsync、原子替换、SHA-256 校验和幂等收据安全写入文本文件。"
  },
  git_inspect: {
    toolset: "workspace.exec",
    title: "检查 Git 仓库",
    description: "通过受监管子进程运行保守的只读 Git 检查，并拦截危险参数。"
  },
  run_workspace_command: {
    toolset: "workspace.exec",
    title: "运行工作区命令",
    description: "仅运行开发者明确允许的可执行文件，并提供超时、取消、输出上限和进程树终止。"
  },
  update_plan: {
    toolset: "agent.internal",
    title: "更新任务计划",
    description: "创建或更新当前 Agent Run 的结构化任务步骤和状态。"
  },
  read_tool_result: {
    toolset: "agent.internal",
    title: "读取工具结果",
    description: "分页读取当前 Agent Run 中被截断的大型工具结果。"
  }
});

export function getBuiltinToolPresentation(name) {
  return BUILTIN_TOOL_PRESENTATION[String(name ?? "")] ?? null;
}

export function getBuiltinToolsetManifest(id) {
  return BUILTIN_TOOLSET_MANIFEST.find((item) => item.id === id) ?? null;
}
