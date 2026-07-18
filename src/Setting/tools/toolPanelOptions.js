export const TOOLSET_OPTIONS = [
  {
    id: "core.runtime",
    title: "时间与运行环境",
    description:
      "提供当前时间、时区、日期计算、精确计算和运行状态。",
    risk: "Safe",
    tools: [
      {
        name: "get_current_time",
        title: "获取当前时间",
        description:
          "读取本机当前时间、UTC 时间、IANA 时区与 UTC 偏移。"
      },
      {
        name: "convert_time_zone",
        title: "换算时区",
        description:
          "在不同 IANA 时区之间换算日期和时间。"
      },
      {
        name: "calculate_date",
        title: "计算日期",
        description:
          "进行日期加减、日期差、星期和 ISO 时间计算。"
      },
      {
        name: "calculator",
        title: "计算器",
        description:
          "使用受限表达式解析器完成精确数学计算，不执行任意代码。"
      },
      {
        name: "get_runtime_info",
        title: "读取运行环境",
        description:
          "读取经过净化的系统、应用、模型和工具运行信息。"
      },
      {
        name: "get_agent_status",
        title: "读取 Agent 状态",
        description:
          "读取当前 Agent Run、模型、计划和工具状态。"
      }
    ]
  },
  {
    id: "workspace.read",
    title: "工作区只读",
    description:
      "在授权目录中浏览、读取和搜索文件，不允许修改。",
    risk: "Read only",
    tools: [
      {
        name: "get_workspace_info",
        title: "查看工作区",
        description:
          "查看当前授权目录、路径别名和固定安全限制。"
      },
      {
        name: "list_directory",
        title: "列出目录",
        description:
          "列出授权目录中的安全文件和子目录。"
      },
      {
        name: "stat_path",
        title: "查看路径信息",
        description:
          "读取路径类型、文件大小和最后修改时间。"
      },
      {
        name: "read_text_file",
        title: "读取文本文件",
        description:
          "按行读取授权工作区内受限大小的安全文本文件。"
      },
      {
        name: "search_files",
        title: "搜索文件",
        description:
          "使用简单 Glob 在授权工作区中搜索文件名。"
      },
      {
        name: "search_text",
        title: "搜索文本",
        description:
          "在安全文本文件中搜索字面文本和代码片段。"
      },
      {
        name: "detect_project",
        title: "识别项目",
        description:
          "通过项目清单识别语言、包管理器、构建系统和脚本。"
      },
      {
        name: "compute_file_hash",
        title: "计算文件哈希",
        description:
          "为授权工作区中的安全文件计算 SHA-256。"
      }
    ]
  },
  {
    id: "agent.internal",
    title: "Agent 内部",
    description:
      "维护任务计划，并在信息不足时向用户确认。",
    risk: "Safe",
    tools: [
      {
        name: "report_progress",
        title: "报告任务进度",
        description:
          "在有意义的工具批次前后发布面向用户的简短进度说明。"
      },
      {
        name: "update_plan",
        title: "更新任务计划",
        description:
          "创建或更新当前 Agent Run 的结构化任务步骤和状态。"
      },
      {
        name: "ask_user",
        title: "询问用户",
        description:
          "在缺少必要信息时暂停工具循环，并显示结构化问题。"
      },
      {
        name: "read_tool_result",
        title: "读取工具结果",
        description:
          "分页读取当前 Agent Run 中被截断的大型工具结果。"
      }
    ]
  }
];

export const TOOL_MODE_OPTIONS = [
  {
    value: "chat",
    label: "Chat"
  },
  {
    value: "coding",
    label: "Coding"
  }
];

export const TOOL_DETAIL_OPTIONS = [
  {
    value: "detailed",
    label: "详细"
  }
];

export const TOOL_OVERRIDE_OPTIONS = [
  {
    value: "inherit",
    label: "跟随模式"
  },
  {
    value: "enabled",
    label: "强制启用"
  },
  {
    value: "disabled",
    label: "强制禁用"
  }
];

export const ALL_TOOL_NAMES =
  TOOLSET_OPTIONS.flatMap(
    (toolset) =>
      toolset.tools.map(
        (tool) => tool.name
      )
  );

export const TOOL_METADATA =
  Object.fromEntries(
    TOOLSET_OPTIONS.flatMap(
      (toolset) =>
        toolset.tools.map(
          (tool) => [
            tool.name,
            {
              ...tool,
              toolset: toolset.id,
              toolsetTitle:
                toolset.title,
              risk: toolset.risk
            }
          ]
        )
    )
  );
