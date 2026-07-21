function normalizeHash(value) {
  return String(value ?? "").toLowerCase();
}

export function fileEvidence({
  operation,
  relativePath,
  beforeSha256 = "",
  afterSha256 = "",
  beforeBytes = 0,
  afterBytes = 0,
  atomic = true,
  dryRun = false,
  created = false,
  movedFrom = "",
  movedTo = ""
} = {}) {
  return {
    kind: "workspace_write_v2",
    operation: String(operation ?? "write"),
    affectedPaths: [String(relativePath ?? "")].filter(Boolean),
    relativePath: String(relativePath ?? ""),
    beforeSha256: normalizeHash(beforeSha256),
    afterSha256: normalizeHash(afterSha256),
    sha256: normalizeHash(afterSha256),
    beforeBytes: Math.max(0, Number(beforeBytes) || 0),
    afterBytes: Math.max(0, Number(afterBytes) || 0),
    bytes: Math.max(0, Number(afterBytes) || 0),
    bytesChanged: Math.abs((Number(afterBytes) || 0) - (Number(beforeBytes) || 0)),
    atomic: atomic === true,
    dryRun: dryRun === true,
    created: created === true,
    movedFrom: String(movedFrom ?? ""),
    movedTo: String(movedTo ?? "")
  };
}

export function transactionEvidence({
  operation = "apply_patch",
  files = [],
  atomic = true,
  dryRun = false,
  rollbackPerformed = false
} = {}) {
  const normalizedFiles = files.map((item) => ({
    path: String(item.path ?? ""),
    beforeSha256: normalizeHash(item.beforeSha256),
    afterSha256: normalizeHash(item.afterSha256),
    beforeBytes: Math.max(0, Number(item.beforeBytes) || 0),
    afterBytes: Math.max(0, Number(item.afterBytes) || 0),
    created: item.created === true
  }));
  return {
    kind: "workspace_write_transaction_v2",
    operation,
    affectedPaths: normalizedFiles.map((item) => item.path),
    files: normalizedFiles,
    bytesChanged: normalizedFiles.reduce(
      (total, item) => total + Math.abs(item.afterBytes - item.beforeBytes),
      0
    ),
    atomic: atomic === true,
    dryRun: dryRun === true,
    rollbackPerformed: rollbackPerformed === true
  };
}

export function receiptFields(evidence, {
  warnings = [],
  rollbackAvailable = false,
  rollbackPerformed = false,
  addedLines = 0,
  removedLines = 0
} = {}) {
  return {
    operation: String(evidence?.operation ?? "write"),
    affectedPaths: [...(evidence?.affectedPaths ?? [])],
    beforeSha256: String(evidence?.beforeSha256 ?? ""),
    afterSha256: String(evidence?.afterSha256 ?? ""),
    bytesChanged: Math.max(0, Number(evidence?.bytesChanged) || 0),
    receiptId: "",
    rollbackAvailable: rollbackAvailable === true,
    rollbackPerformed: rollbackPerformed === true,
    addedLines: Math.max(0, Number(addedLines) || 0),
    removedLines: Math.max(0, Number(removedLines) || 0),
    warnings: warnings.map(String).filter(Boolean),
    effectEvidence: evidence
  };
}
