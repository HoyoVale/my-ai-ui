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
    description: "按深度、过滤规则和稳定顺序列出授权目录中的安全文件与子目录。"
  },
  list_directory_tree: {
    toolset: "workspace.read",
    title: "查看目录树",
    description: "生成受深度、条目数和固定安全边界限制的项目目录树。"
  },
  stat_path: {
    toolset: "workspace.read",
    title: "查看路径信息",
    description: "兼容性读取路径类型、文件大小和最后修改时间。"
  },
  inspect_path: {
    toolset: "workspace.read",
    title: "深度检查路径",
    description: "检查路径存在性、类型、编码、换行、哈希和安全符号链接信息。"
  },
  read_text_file: {
    toolset: "workspace.read",
    title: "读取文本文件",
    description: "按行读取受限大小的 UTF-8 或 UTF-16LE 文本，并返回编码、换行和哈希证据。"
  },
  read_multiple_files: {
    toolset: "workspace.read",
    title: "批量读取文件",
    description: "在单次有界调用中读取多个小型文本文件，并隔离单文件错误。"
  },
  compare_files: {
    toolset: "workspace.read",
    title: "比较两个文件",
    description: "比较同一授权工作区中的两个文本文件，返回有界 Diff、哈希与行数统计。"
  },
  search_files: {
    toolset: "workspace.read",
    title: "搜索文件",
    description: "使用有界 Glob、排除规则、类型、大小和修改时间筛选工作区路径。"
  },
  search_text: {
    toolset: "workspace.read",
    title: "搜索文本",
    description: "使用字面文本或受限正则搜索，并返回行列、上下文和扫描限制。"
  },
  git_diff: {
    toolset: "workspace.read",
    title: "读取 Git 差异",
    description: "通过受监管 Git 子进程读取未暂存、已暂存或 revision 范围差异。"
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
    description: "通过 Dry-run、编码与换行保留、SHA-256 前置条件、原子替换和收据安全创建或覆盖文本文件。"
  },
  replace_text_in_file: {
    toolset: "workspace.write",
    title: "精确替换文件文本",
    description: "只在匹配次数符合预期时替换文本，避免模糊修改，并保留原编码与换行。"
  },
  append_text_file: {
    toolset: "workspace.write",
    title: "追加文本文件",
    description: "通过完整原子替换安全追加文本，文件创建必须显式允许。"
  },
  create_directory: {
    toolset: "workspace.write",
    title: "创建目录",
    description: "在授权工作区内创建目录；递归创建父目录必须显式开启。"
  },
  move_path: {
    toolset: "workspace.write",
    title: "移动文件或目录",
    description: "在同一授权工作区内原子移动路径，默认且当前始终禁止覆盖已有目标。"
  },
  delete_path: {
    toolset: "workspace.write",
    title: "删除文件或目录",
    description: "永久删除授权工作区内的安全路径；递归删除必须显式开启，并始终逐次请求批准。"
  },
  apply_patch: {
    toolset: "workspace.write",
    title: "应用统一补丁",
    description: "先校验全部 hunk，再以多文件事务提交 Unified Diff；失败时整体回滚。"
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
