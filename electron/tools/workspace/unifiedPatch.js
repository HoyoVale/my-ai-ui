import path from "node:path";

function patchError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function cleanHeaderPath(value) {
  const source = String(value ?? "").trim().split(/\t|\s{2,}/u)[0];
  if (source === "/dev/null") return source;
  return source.replace(/^(?:a|b)\//u, "");
}

export function assertSafePatchPath(value) {
  const candidate = cleanHeaderPath(value);
  if (!candidate || candidate === "/dev/null") return candidate;
  if (path.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/u.test(candidate)) {
    throw patchError("PATCH_PATH_INVALID", "补丁不能包含绝对路径。", { path: candidate });
  }
  const normalized = path.posix.normalize(candidate.replace(/\\/gu, "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw patchError("PATH_OUTSIDE_WORKSPACE", "补丁路径不能越出工作区。", { path: candidate });
  }
  return normalized;
}

function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/u.exec(line);
  if (!match) {
    throw patchError("PATCH_INVALID", `无效的补丁 hunk 头：${line}`);
  }
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
    lines: []
  };
}

function validateHunkCounts(hunk, filePath) {
  const oldCount = hunk.lines.filter((line) => line.kind !== "add").length;
  const newCount = hunk.lines.filter((line) => line.kind !== "remove").length;
  if (oldCount !== hunk.oldCount || newCount !== hunk.newCount) {
    throw patchError(
      "PATCH_INVALID",
      `补丁 ${filePath} 的 hunk 行数与头部声明不一致。`,
      {
        oldExpected: hunk.oldCount,
        oldActual: oldCount,
        newExpected: hunk.newCount,
        newActual: newCount
      }
    );
  }
}

export function parseUnifiedPatch(value, { maxFiles = 20, maxHunks = 200 } = {}) {
  const patch = String(value ?? "").replace(/\r\n|\r/gu, "\n");
  if (!patch.trim()) throw patchError("PATCH_EMPTY", "补丁内容不能为空。");
  const lines = patch.split("\n");
  const files = [];
  let index = 0;
  let hunkTotal = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("new file mode ")) {
      index += 1;
      continue;
    }
    if (!line.startsWith("--- ")) {
      throw patchError("PATCH_INVALID", `预期文件头 ---，实际为：${line}`);
    }
    const oldPath = assertSafePatchPath(line.slice(4));
    index += 1;
    if (index >= lines.length || !lines[index].startsWith("+++ ")) {
      throw patchError("PATCH_INVALID", "补丁文件头缺少 +++ 路径。");
    }
    const newPath = assertSafePatchPath(lines[index].slice(4));
    index += 1;
    if (newPath === "/dev/null") {
      throw patchError("PATCH_DELETE_NOT_SUPPORTED", "Tool Write 2.0 暂不允许通过补丁删除文件。");
    }
    const created = oldPath === "/dev/null";
    if (!created && oldPath !== newPath) {
      throw patchError("PATCH_RENAME_NOT_SUPPORTED", "补丁不能隐式重命名文件，请使用 move_path。", {
        oldPath,
        newPath
      });
    }
    const file = { oldPath, newPath, path: newPath, created, hunks: [], addedLines: 0, removedLines: 0 };

    while (index < lines.length) {
      const current = lines[index];
      if (current.startsWith("--- ") || current.startsWith("diff --git ")) break;
      if (!current) {
        index += 1;
        continue;
      }
      if (!current.startsWith("@@ ")) {
        throw patchError("PATCH_INVALID", `预期 hunk 头，实际为：${current}`);
      }
      const hunk = parseHunkHeader(current);
      index += 1;
      hunkTotal += 1;
      if (hunkTotal > maxHunks) {
        throw patchError("PATCH_TOO_LARGE", `补丁 hunk 数不能超过 ${maxHunks}。`);
      }
      while (index < lines.length) {
        const hunkLine = lines[index];
        if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("diff --git ")) break;
        if (hunkLine === "" && index === lines.length - 1) {
          index += 1;
          break;
        }
        index += 1;
        if (hunkLine === "\\ No newline at end of file") continue;
        const marker = hunkLine[0];
        if (![" ", "+", "-"].includes(marker)) {
          throw patchError("PATCH_INVALID", `补丁行缺少空格、+ 或 - 前缀：${hunkLine}`);
        }
        const kind = marker === "+" ? "add" : marker === "-" ? "remove" : "context";
        hunk.lines.push({ kind, text: hunkLine.slice(1) });
        if (kind === "add") file.addedLines += 1;
        if (kind === "remove") file.removedLines += 1;
      }
      validateHunkCounts(hunk, file.path);
      file.hunks.push(hunk);
    }
    if (file.hunks.length === 0) {
      throw patchError("PATCH_INVALID", `文件 ${file.path} 没有可应用的 hunk。`);
    }
    files.push(file);
    if (files.length > maxFiles) {
      throw patchError("PATCH_TOO_LARGE", `补丁文件数不能超过 ${maxFiles}。`);
    }
  }

  if (files.length === 0) throw patchError("PATCH_INVALID", "没有解析到可应用的文件补丁。");
  const duplicate = files.find((file, i) => files.findIndex((item) => item.path === file.path) !== i);
  if (duplicate) throw patchError("PATCH_DUPLICATE_FILE", `补丁重复修改文件 ${duplicate.path}。`);
  return { files, addedLines: files.reduce((sum, file) => sum + file.addedLines, 0), removedLines: files.reduce((sum, file) => sum + file.removedLines, 0) };
}

function splitTextLines(value) {
  const normalized = String(value ?? "").replace(/\r\n|\r/gu, "\n");
  const finalNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

export function applyUnifiedFilePatch(currentText, filePatch) {
  const source = splitTextLines(currentText);
  const output = [...source.lines];
  let offset = 0;

  for (const hunk of filePatch.hunks) {
    const index = Math.max(0, hunk.oldStart - 1 + offset);
    const expected = hunk.lines
      .filter((line) => line.kind !== "add")
      .map((line) => line.text);
    const actual = output.slice(index, index + expected.length);
    const mismatch = expected.findIndex((line, lineIndex) => actual[lineIndex] !== line);
    if (mismatch >= 0 || actual.length !== expected.length) {
      throw patchError(
        "PATCH_CONFLICT",
        `补丁无法应用到 ${filePatch.path} 的第 ${hunk.oldStart} 行附近。`,
        {
          path: filePatch.path,
          line: hunk.oldStart + Math.max(0, mismatch),
          expected: expected[mismatch] ?? "",
          actual: actual[mismatch] ?? ""
        }
      );
    }
    const replacement = hunk.lines
      .filter((line) => line.kind !== "remove")
      .map((line) => line.text);
    output.splice(index, expected.length, ...replacement);
    offset += replacement.length - expected.length;
  }

  const finalNewline = filePatch.created ? true : source.finalNewline;
  return output.join("\n") + (finalNewline ? "\n" : "");
}
