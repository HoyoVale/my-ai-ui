export const TOOLSET_OPTIONS = [
  {
    id: "core.runtime",
    title: "时间与运行环境",
    description:
      "提供当前时间、时区、日期计算、精确计算和运行状态。",
    risk: "安全",
    tools: [
      {
        name: "get_current_time",
        title: "当前时间",
        description:
          "读取本机当前时间、UTC、时区与偏移。"
      },
      {
        name: "convert_time_zone",
        title: "时区换算",
        description:
          "在 IANA 时区之间换算日期和时间。"
      },
      {
        name: "calculate_date",
        title: "日期计算",
        description:
          "进行日期加减、日期差和星期计算。"
      },
      {
        name: "calculator",
        title: "计算器",
        description:
          "使用受限表达式解析器完成精确数学计算。"
      },
      {
        name: "get_runtime_info",
        title: "运行环境",
        description:
          "读取经过净化的系统、应用、模型和工具状态。"
      },
      {
        name: "get_agent_status",
        title: "Agent 状态",
        description:
          "读取当前运行状态、计划和模型信息。"
      }
    ]
  },
  {
    id: "workspace.read",
    title: "工作区只读",
    description:
      "在授权目录中浏览、读取和搜索文件，不允许修改。",
    risk: "只读",
    tools: [
      {
        name: "get_workspace_info",
        title: "工作区信息",
        description:
          "查看授权目录和固定安全限制。"
      },
      {
        name: "list_directory",
        title: "列出目录",
        description:
          "列出目录中的安全文件和子目录。"
      },
      {
        name: "stat_path",
        title: "路径信息",
        description:
          "读取文件类型、大小和修改时间。"
      },
      {
        name: "read_text_file",
        title: "读取文本",
        description:
          "按行读取受限大小的安全文本文件。"
      },
      {
        name: "search_files",
        title: "搜索文件",
        description:
          "使用简单 Glob 在工作区中搜索文件名。"
      },
      {
        name: "search_text",
        title: "搜索文本",
        description:
          "在安全文本文件中搜索字面文本。"
      },
      {
        name: "detect_project",
        title: "识别项目",
        description:
          "通过项目清单识别语言、构建系统和脚本。"
      },
      {
        name: "compute_file_hash",
        title: "文件哈希",
        description:
          "为安全文件计算 SHA-256。"
      }
    ]
  },
  {
    id: "agent.internal",
    title: "Agent 内部",
    description:
      "维护任务计划，并在信息不足时向用户确认。",
    risk: "安全",
    tools: [
      {
        name: "update_plan",
        title: "更新计划",
        description:
          "维护当前任务的结构化步骤和状态。"
      },
      {
        name: "ask_user",
        title: "询问用户",
        description:
          "暂停工具循环并显示结构化确认问题。"
      }
    ]
  }
];

export const TOOL_PROFILE_OPTIONS = [
  {
    value: "chat",
    label: "对话"
  },
  {
    value: "workspace",
    label: "工作区"
  },
  {
    value: "custom",
    label: "自定义"
  }
];

export const ALL_TOOL_NAMES =
  TOOLSET_OPTIONS.flatMap(
    (toolset) =>
      toolset.tools.map(
        (tool) => tool.name
      )
  );
