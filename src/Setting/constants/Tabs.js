export const SETTING_GROUPS = [
  {
    id: "app",
    label: "应用",
    tabs: [
      {
        id: "general",
        label: "General",
        title: "通用",
        description:
          "管理应用启动方式与桌宠位置记忆。"
      },
      {
        id: "appearance",
        label: "Appearance",
        title: "外观",
        description:
          "设置主题、强调色与动画偏好。"
      }
    ]
  },

  {
    id: "windows",
    label: "窗口",
    tabs: [
      {
        id: "pet",
        label: "Pet",
        title: "桌宠",
        description:
          "调整桌宠尺寸、透明度和窗口行为。"
      },
      {
        id: "input",
        label: "Input",
        title: "输入框",
        description:
          "调整输入窗口的尺寸、文字和视觉样式。"
      },
      {
        id: "response",
        label: "Response",
        title: "回复气泡",
        description:
          "调整回复气泡的位置、尺寸、样式和关闭行为。"
      },
    ]
  },

  {
    id: "ai",
    label: "AI",
    tabs: [
      {
        id: "workspace",
        label: "Workspace",
        title: "工作上下文",
        description:
          "管理工作模式、注册工作区以及会话的项目归属。"
      },
      {
        id: "personality",
        label: "Personality",
        title: "个性",
        description:
          "配置助手身份、语言、语气和稳定行为说明。"
      },
      {
        id: "model",
        label: "Model",
        title: "模型",
        description:
          "配置模型服务、API 凭据与生成参数。"
      },
      {
        id: "conversation",
        label: "Context",
        title: "会话与上下文",
        description:
          "管理运行环境注入、短期上下文和会话数据。"
      },
      {
        id: "tools",
        label: "Tools",
        title: "工具",
        description:
          "管理 Tool Runtime、工具权限和开发者执行边界。"
      },
      {
        id: "memory",
        label: "Memory",
        title: "长期记忆",
        description:
          "管理长期记忆的启用、检索阈值和数据。"
      }
    ]
  },

  {
    id: "developer",
    label: "开发者",
    developerOnly: true,
    tabs: [
      {
        id: "mcp",
        label: "MCP",
        title: "MCP",
        description:
          "连接、发现和管理外部 MCP Server 与工具。"
      },
      {
        id: "developer",
        label: "Developer",
        title: "开发者",
        description:
          "查看 Agent Runtime、工具和模型诊断信息。"
      }
    ]
  },

  {
    id: "other",
    label: "其他",
    tabs: [
      {
        id: "about",
        label: "About",
        title: "关于",
        description:
          "查看应用版本、运行环境和设置文件位置。"
      }
    ]
  }
];

export const SETTING_TABS =
  SETTING_GROUPS.flatMap(
    (group) => group.tabs
  );
