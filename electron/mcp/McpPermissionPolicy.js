const READ_ONLY_NAME_PATTERN = /^(?:read|get|list|search|find|query|fetch|inspect|describe|show|view|lookup|check|status|health|ping|resolve|preview)(?:[_-]|$)/iu;

function toolCapabilities(tool = {}) {
  const annotations = tool.annotations ?? {};
  const declared = Array.isArray(annotations.capabilities)
    ? annotations.capabilities.map((item) => String(item ?? "").toLowerCase())
    : [];
  const hasReadOnlyHint = typeof annotations.readOnlyHint === "boolean";
  const inferredReadOnly = !hasReadOnlyHint && READ_ONLY_NAME_PATTERN.test(String(tool.name ?? ""));
  const readOnly = annotations.readOnlyHint === true || inferredReadOnly;
  const destructive = annotations.destructiveHint === true;
  return {
    readOnly,
    readOnlySource: hasReadOnlyHint ? "annotation" : (inferredReadOnly ? "name" : "unknown"),
    destructive,
    fileRead: declared.includes("filesystem.read") || declared.includes("file.read"),
    fileWrite: declared.includes("filesystem.write") || declared.includes("file.write"),
    network: declared.includes("network"),
    account: declared.includes("account") || declared.includes("oauth"),
    externalWrite: !readOnly
  };
}

export function defaultMcpPermissions(server = {}) {
  const writable = server.readOnly !== true;
  return {
    localProcess: true,
    network: true,
    account: true,
    fileRead: true,
    fileWrite: writable,
    externalWrite: writable,
    destructive: false,
    tools: {}
  };
}

export class McpPermissionPolicy {
  connectionDecision(server = {}) {
    const permissions = {
      ...defaultMcpPermissions(server),
      ...(server.permissions ?? {})
    };
    if (server.transport === "stdio" && permissions.localProcess === false) {
      return { allowed: false, reason: "该连接未获准启动本地进程。", code: "MCP_PROCESS_PERMISSION_DENIED" };
    }
    if (server.transport === "streamable-http" && permissions.network === false) {
      return { allowed: false, reason: "该连接未获准访问网络。", code: "MCP_NETWORK_PERMISSION_DENIED" };
    }
    if (server.authMode && server.authMode !== "none" && permissions.account === false) {
      return { allowed: false, reason: "该连接未获准使用账户认证。", code: "MCP_ACCOUNT_PERMISSION_DENIED" };
    }
    return { allowed: true, permissions };
  }

  toolDecision(server = {}, tool = {}) {
    const permissions = {
      ...defaultMcpPermissions(server),
      ...(server.permissions ?? {}),
      tools: {
        ...(defaultMcpPermissions(server).tools ?? {}),
        ...(server.permissions?.tools ?? {})
      }
    };
    const rule = permissions.tools?.[tool.name] ?? "inherit";
    const capabilities = toolCapabilities(tool);
    const base = { rule, capabilities };

    if (rule === "deny") {
      return {
        ...base,
        allowed: false,
        reason: "此工具已在 MCP 权限矩阵中禁用。",
        code: "MCP_TOOL_PERMISSION_DENIED"
      };
    }
    if (server.readOnly === true && !capabilities.readOnly) {
      return {
        ...base,
        allowed: false,
        reason: "该 MCP 连接处于只读模式；只有 Server 明确标记为只读的工具可调用。",
        code: "MCP_READ_ONLY_DENIED"
      };
    }
    if (capabilities.destructive && permissions.destructive !== true) {
      return {
        ...base,
        allowed: false,
        reason: "该工具被标记为破坏性操作，当前未授权。",
        code: "MCP_DESTRUCTIVE_PERMISSION_DENIED"
      };
    }
    if (capabilities.externalWrite && permissions.externalWrite !== true) {
      return {
        ...base,
        allowed: false,
        reason: "该工具可能执行外部写入，当前未授权。",
        code: "MCP_EXTERNAL_WRITE_PERMISSION_DENIED"
      };
    }
    if (capabilities.fileRead && permissions.fileRead !== true) {
      return {
        ...base,
        allowed: false,
        reason: "该工具声明需要文件读取权限。",
        code: "MCP_FILE_READ_PERMISSION_DENIED"
      };
    }
    if (capabilities.fileWrite && permissions.fileWrite !== true) {
      return {
        ...base,
        allowed: false,
        reason: "该工具声明需要文件写入权限。",
        code: "MCP_FILE_WRITE_PERMISSION_DENIED"
      };
    }
    if (capabilities.network && permissions.network !== true) {
      return {
        ...base,
        allowed: false,
        reason: "该工具声明需要网络权限。",
        code: "MCP_NETWORK_PERMISSION_DENIED"
      };
    }
    if (capabilities.account && permissions.account !== true) {
      return {
        ...base,
        allowed: false,
        reason: "该工具声明需要账户权限。",
        code: "MCP_ACCOUNT_PERMISSION_DENIED"
      };
    }
    return { ...base, allowed: true };
  }

  assertToolAllowed(server, tool) {
    const decision = this.toolDecision(server, tool);
    if (!decision.allowed) {
      const error = new Error(decision.reason);
      error.code = decision.code;
      throw error;
    }
    return decision;
  }
}
