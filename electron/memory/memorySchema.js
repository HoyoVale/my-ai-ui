const STORE_VERSION = 1;

export const MEMORY_CATEGORIES = Object.freeze([
  "profile",
  "preference",
  "project",
  "constraint",
  "other"
]);

const CATEGORY_SET =
  new Set(MEMORY_CATEGORIES);

function stringValue(
  value,
  fallback = "",
  maxLength = 4000
) {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : fallback;
}

function timestampValue(
  value,
  fallback = 0
) {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : fallback;
}

function importanceValue(
  value,
  fallback = 0.5
) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(
    Math.max(numeric, 0),
    1
  );
}

export function normalizeMemoryContent(
  value
) {
  return stringValue(
    value,
    "",
    2000
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function createMemoryKey({
  category,
  content
}) {
  return `${category}:${normalizeMemoryContent(content).toLocaleLowerCase()}`;
}

export function createEmptyMemoryData() {
  return {
    version: STORE_VERSION,
    memories: []
  };
}

export function sanitizeMemory(
  source,
  fallbackTimestamp = 0
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const id =
    stringValue(
      source.id,
      "",
      100
    ).trim();

  const content =
    normalizeMemoryContent(
      source.content
    );

  if (!id || !content) {
    return null;
  }

  const category =
    CATEGORY_SET.has(
      source.category
    )
      ? source.category
      : "other";

  const createdAt =
    timestampValue(
      source.createdAt,
      fallbackTimestamp
    );

  const updatedAt =
    Math.max(
      createdAt,
      timestampValue(
        source.updatedAt,
        createdAt
      )
    );

  const lastUsedAt =
    timestampValue(
      source.lastUsedAt,
      0
    );

  const sourceConversationId =
    stringValue(
      source.sourceConversationId,
      "",
      100
    ).trim() || null;

  return {
    id,
    category,
    content,
    importance:
      importanceValue(
        source.importance,
        0.5
      ),
    enabled:
      typeof source.enabled ===
        "boolean"
        ? source.enabled
        : true,
    sourceConversationId,
    createdAt,
    updatedAt,
    lastUsedAt
  };
}

export function sanitizeMemoryData(
  source
) {
  const fallback =
    createEmptyMemoryData();

  if (
    !source ||
    typeof source !== "object"
  ) {
    return fallback;
  }

  const memories =
    Array.isArray(
      source.memories
    )
      ? source.memories
          .map((memory) =>
            sanitizeMemory(memory)
          )
          .filter(Boolean)
      : [];

  const unique = [];
  const seenIds = new Set();
  const seenKeys = new Set();

  for (const memory of memories) {
    const key =
      createMemoryKey(memory);

    if (
      seenIds.has(memory.id) ||
      seenKeys.has(key)
    ) {
      continue;
    }

    seenIds.add(memory.id);
    seenKeys.add(key);
    unique.push(memory);
  }

  unique.sort(
    (left, right) =>
      right.importance -
        left.importance ||
      right.updatedAt -
        left.updatedAt
  );

  return {
    version: STORE_VERSION,
    memories: unique
  };
}
