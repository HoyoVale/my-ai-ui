const STORE_VERSION = 3;

const LEGACY_CATEGORY_LABELS = {
  profile: "资料",
  preference: "偏好",
  project: "项目",
  constraint: "约束",
  other: "其他"
};

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

function priorityValue(
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

export function normalizeMemoryTitle(
  value,
  content = ""
) {
  const explicit =
    stringValue(
      value,
      "",
      120
    )
      .replace(/\s+/g, " ")
      .trim();

  if (explicit) {
    return explicit;
  }

  const normalizedContent =
    normalizeMemoryContent(
      content
    );

  if (!normalizedContent) {
    return "";
  }

  const firstSentence =
    normalizedContent
      .split(/[。！？\n]/u)[0]
      .trim();

  const source =
    firstSentence ||
    normalizedContent;

  return source.length > 48
    ? `${source.slice(0, 48)}…`
    : source;
}

export function normalizeMemoryDescription(
  value
) {
  return stringValue(
    value,
    "",
    500
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMemoryTags(
  value
) {
  const source =
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,，]/u)
        : [];

  const tags = [];
  const seen = new Set();

  for (const item of source) {
    const tag =
      stringValue(
        item,
        "",
        40
      )
        .replace(/\s+/g, " ")
        .trim();

    const key =
      tag.toLocaleLowerCase();

    if (
      !tag ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    tags.push(tag);

    if (tags.length >= 12) {
      break;
    }
  }

  return tags;
}

function legacyDescription(
  category
) {
  const label =
    LEGACY_CATEGORY_LABELS[
      category
    ];

  return label
    ? `由旧版“${label}”分类迁移。`
    : "";
}

export function createMemoryKey({
  content
}) {
  return normalizeMemoryContent(
    content
  ).toLocaleLowerCase();
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

  const legacyCategory =
    typeof source.category ===
      "string"
      ? source.category
      : "";

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

  return {
    id,
    title:
      normalizeMemoryTitle(
        source.title,
        content
      ),
    content,
    description:
      normalizeMemoryDescription(
        source.description ||
        legacyDescription(
          legacyCategory
        )
      ),
    tags:
      normalizeMemoryTags(
        source.tags
      ),
    priority:
      priorityValue(
        source.priority ??
        source.importance,
        0.5
      ),
    enabled:
      typeof source.enabled ===
        "boolean"
        ? source.enabled
        : true,
    sourceConversationId:
      stringValue(
        source.sourceConversationId,
        "",
        100
      ).trim() || null,
    createdAt,
    updatedAt,
    lastUsedAt:
      timestampValue(
        source.lastUsedAt,
        0
      )
  };
}

function mergeDuplicateMemory(
  target,
  incoming
) {
  const incomingIsNewer =
    incoming.updatedAt >=
    target.updatedAt;

  if (incomingIsNewer) {
    target.title =
      incoming.title ||
      target.title;
    target.description =
      incoming.description ||
      target.description;
    target.sourceConversationId =
      incoming.sourceConversationId ||
      target.sourceConversationId;
  }

  target.tags =
    normalizeMemoryTags([
      ...target.tags,
      ...incoming.tags
    ]);
  target.priority =
    Math.max(
      target.priority,
      incoming.priority
    );
  target.enabled =
    target.enabled ||
    incoming.enabled;
  target.createdAt =
    Math.min(
      target.createdAt ||
        incoming.createdAt,
      incoming.createdAt ||
        target.createdAt
    );
  target.updatedAt =
    Math.max(
      target.updatedAt,
      incoming.updatedAt
    );
  target.lastUsedAt =
    Math.max(
      target.lastUsedAt,
      incoming.lastUsedAt
    );
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
  const byId = new Set();
  const byKey = new Map();

  for (const memory of memories) {
    if (byId.has(memory.id)) {
      continue;
    }

    byId.add(memory.id);

    const key =
      createMemoryKey(memory);

    const duplicate =
      byKey.get(key);

    if (duplicate) {
      mergeDuplicateMemory(
        duplicate,
        memory
      );
      continue;
    }

    byKey.set(key, memory);
    unique.push(memory);
  }

  unique.sort(
    (left, right) =>
      right.priority -
        left.priority ||
      right.updatedAt -
        left.updatedAt
  );

  return {
    version: STORE_VERSION,
    memories: unique
  };
}
