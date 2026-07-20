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
          "读取当前 Agent Run、模型和精简计划状态，不返回原始工具记录。"
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
    id: "workspace.write",
    title: "工作区写入",
    description:
      "仅在 Coding 模式中使用原子写入修改授权工作区内的文本文件。",
    risk: "Local write",
    tools: [
      {
        name: "write_text_file",
        title: "原子写入文本文件",
        description:
          "通过临时文件、fsync、原子替换、SHA-256 校验和幂等收据安全写入一个文本文件。"
      }
    ]
  },
  {
    id: "workspace.exec",
    userVisible: false,
    title: "工作区进程",
    description:
      "通过受监管的子进程运行只读 Git 检查或显式允许的工作区命令。",
    risk: "High risk",
    tools: [
      {
        name: "git_inspect",
        title: "检查 Git 仓库",
        description:
          "通过 Subprocess Supervisor 运行保守的只读 Git 检查；拦截分支修改、外部 diff 和文件输出参数。"
      },
      {
        name: "run_workspace_command",
        title: "运行工作区命令",
        description:
          "仅运行开发者明确加入允许列表的可执行文件，并提供超时、取消、输出上限和进程树终止；它不是操作系统沙箱。"
      }
    ]
  },
  {
    id: "agent.internal",
    userVisible: false,
    title: "Agent 内部",
    description:
      "维护任务计划、进度和大型结果引用。",
    risk: "Safe",
    tools: [
      {
        name: "update_plan",
        title: "更新任务计划",
        description:
          "创建或更新当前 Agent Run 的结构化任务步骤和状态。"
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
