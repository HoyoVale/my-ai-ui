import crypto from "node:crypto";

import {
  createMemoryKey,
  normalizeMemoryContent,
  normalizeMemoryDescription,
  normalizeMemoryTags,
  normalizeMemoryTitle
} from "./memorySchema.js";

function clone(value) {
  return structuredClone(value);
}

function clampPriority(
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

function tokenize(value) {
  const normalized =
    String(value ?? "")
      .toLocaleLowerCase();

  const latin =
    normalized.match(
      /[a-z0-9_-]{2,}/g
    ) ?? [];

  const han =
    normalized.match(
      /\p{Script=Han}/gu
    ) ?? [];

  return new Set([
    ...latin,
    ...han
  ]);
}

function searchableText(memory) {
  return [
    memory.title,
    memory.content,
    memory.description,
    ...(memory.tags ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function relevanceScore(
  memory,
  query
) {
  const normalizedQuery =
    String(query ?? "")
      .trim()
      .toLocaleLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  const normalizedMemory =
    searchableText(memory);

  let score = 0;

  if (
    normalizedMemory.includes(
      normalizedQuery
    )
  ) {
    score += 24;
  }

  if (
    normalizedQuery.includes(
      memory.content
        .toLocaleLowerCase()
    )
  ) {
    score += 18;
  }

  const queryTokens =
    tokenize(normalizedQuery);

  const memoryTokens =
    tokenize(normalizedMemory);

  for (const token of queryTokens) {
    if (memoryTokens.has(token)) {
      score += 8;
    }
  }

  return score;
}

function mergeTags(
  left,
  right
) {
  return normalizeMemoryTags([
    ...(left ?? []),
    ...(right ?? [])
  ]);
}

export class MemoryManager {
  constructor({
    store,
    getSettings,
    now = () => Date.now(),
    createId = () =>
      crypto.randomUUID(),
    onChange = () => {}
  }) {
    if (!store) {
      throw new TypeError(
        "MemoryManager requires a store."
      );
    }

    this.store = store;
    this.getSettings =
      typeof getSettings ===
        "function"
        ? getSettings
        : () => ({
            memory: {
              enabled: true,
              maxInjected: 5,
              minPriority: 0.3
            }
          });
    this.now = now;
    this.createId = createId;
    this.onChange = onChange;
    this.data = null;
  }

  ensureLoaded() {
    if (!this.data) {
      this.data =
        this.store.load();
    }

    return this.data;
  }

  getState() {
    const memories =
      this.ensureLoaded()
        .memories;

    return {
      totalMemories:
        memories.length,
      enabledMemories:
        memories.filter(
          (memory) =>
            memory.enabled
        ).length,
      disabledMemories:
        memories.filter(
          (memory) =>
            !memory.enabled
        ).length
    };
  }

  list({
    query = "",
    enabled = "all"
  } = {}) {
    const normalizedQuery =
      String(query ?? "")
        .trim()
        .toLocaleLowerCase();

    return this.ensureLoaded()
      .memories
      .filter((memory) => {
        if (
          enabled === true &&
          !memory.enabled
        ) {
          return false;
        }

        if (
          enabled === false &&
          memory.enabled
        ) {
          return false;
        }

        return (
          !normalizedQuery ||
          searchableText(memory)
            .includes(
              normalizedQuery
            )
        );
      })
      .map(clone);
  }

  get(id) {
    const memory =
      this.ensureLoaded()
        .memories
        .find(
          (item) =>
            item.id === id
        );

    return memory
      ? clone(memory)
      : null;
  }

  create({
    title = "",
    content,
    description = "",
    tags = [],
    priority = 0.5,
    enabled = true,
    sourceConversationId = null
  }) {
    const normalizedContent =
      normalizeMemoryContent(
        content
      );

    if (!normalizedContent) {
      return {
        ok: false,
        code: "empty-memory",
        message:
          "记忆内容不能为空。"
      };
    }

    const normalizedTitle =
      normalizeMemoryTitle(
        title,
        normalizedContent
      );

    const normalizedDescription =
      normalizeMemoryDescription(
        description
      );

    const normalizedTags =
      normalizeMemoryTags(tags);

    const data =
      this.ensureLoaded();

    const key =
      createMemoryKey({
        content:
          normalizedContent
      });

    const duplicate =
      data.memories.find(
        (memory) =>
          createMemoryKey(
            memory
          ) === key
      );

    const timestamp =
      this.now();

    if (duplicate) {
      duplicate.title =
        normalizedTitle;
      duplicate.content =
        normalizedContent;
      duplicate.description =
        normalizedDescription ||
        duplicate.description;
      duplicate.tags =
        mergeTags(
          duplicate.tags,
          normalizedTags
        );
      duplicate.priority =
        clampPriority(
          priority,
          duplicate.priority
        );
      duplicate.enabled =
        Boolean(enabled);
      duplicate.sourceConversationId =
        String(
          sourceConversationId ?? ""
        ).trim() ||
        duplicate
          .sourceConversationId ||
        null;
      duplicate.updatedAt =
        timestamp;

      this.commit();

      return {
        ok: true,
        created: false,
        deduplicated: true,
        memory:
          clone(duplicate)
      };
    }

    const memory = {
      id: this.createId(),
      title:
        normalizedTitle,
      content:
        normalizedContent,
      description:
        normalizedDescription,
      tags:
        normalizedTags,
      priority:
        clampPriority(
          priority
        ),
      enabled:
        Boolean(enabled),
      sourceConversationId:
        String(
          sourceConversationId ?? ""
        ).trim() || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: 0
    };

    data.memories.push(memory);
    this.commit();

    return {
      ok: true,
      created: true,
      deduplicated: false,
      memory: clone(memory)
    };
  }

  update(
    id,
    patch = {}
  ) {
    const data =
      this.ensureLoaded();

    const memory =
      data.memories.find(
        (item) =>
          item.id === id
      );

    if (!memory) {
      return {
        ok: false,
        code: "memory-not-found",
        message:
          "找不到这条记忆。"
      };
    }

    const nextContent =
      patch.content ===
        undefined
        ? memory.content
        : normalizeMemoryContent(
            patch.content
          );

    if (!nextContent) {
      return {
        ok: false,
        code: "empty-memory",
        message:
          "记忆内容不能为空。"
      };
    }

    const nextTitle =
      patch.title === undefined
        ? memory.title
        : normalizeMemoryTitle(
            patch.title,
            nextContent
          );

    const nextDescription =
      patch.description ===
        undefined
        ? memory.description
        : normalizeMemoryDescription(
            patch.description
          );

    const nextTags =
      patch.tags === undefined
        ? memory.tags
        : normalizeMemoryTags(
            patch.tags
          );

    const nextKey =
      createMemoryKey({
        content:
          nextContent
      });

    const duplicate =
      data.memories.find(
        (item) =>
          item.id !== id &&
          createMemoryKey(item) ===
            nextKey
      );

    const timestamp =
      this.now();

    if (duplicate) {
      duplicate.title =
        nextTitle ||
        duplicate.title;
      duplicate.description =
        nextDescription ||
        duplicate.description;
      duplicate.tags =
        mergeTags(
          duplicate.tags,
          nextTags
        );
      duplicate.priority =
        patch.priority ===
          undefined
          ? Math.max(
              duplicate.priority,
              memory.priority
            )
          : clampPriority(
              patch.priority,
              duplicate.priority
            );
      duplicate.enabled =
        patch.enabled ===
          undefined
          ? duplicate.enabled ||
            memory.enabled
          : Boolean(
              patch.enabled
            );
      duplicate.sourceConversationId =
        patch.sourceConversationId ===
          undefined
          ? duplicate
              .sourceConversationId ||
            memory
              .sourceConversationId ||
            null
          : String(
              patch.sourceConversationId ??
                ""
            ).trim() || null;
      duplicate.updatedAt =
        timestamp;

      data.memories =
        data.memories.filter(
          (item) =>
            item.id !== id
        );

      this.commit();

      return {
        ok: true,
        merged: true,
        memory:
          clone(duplicate)
      };
    }

    memory.title =
      nextTitle;
    memory.content =
      nextContent;
    memory.description =
      nextDescription;
    memory.tags =
      nextTags;

    if (
      patch.priority !==
      undefined
    ) {
      memory.priority =
        clampPriority(
          patch.priority,
          memory.priority
        );
    }

    if (
      patch.enabled !==
      undefined
    ) {
      memory.enabled =
        Boolean(
          patch.enabled
        );
    }

    if (
      patch.sourceConversationId !==
      undefined
    ) {
      memory.sourceConversationId =
        String(
          patch.sourceConversationId ??
            ""
        ).trim() || null;
    }

    memory.updatedAt =
      timestamp;

    this.commit();

    return {
      ok: true,
      merged: false,
      memory: clone(memory)
    };
  }

  delete(id) {
    const data =
      this.ensureLoaded();

    const previousLength =
      data.memories.length;

    data.memories =
      data.memories.filter(
        (memory) =>
          memory.id !== id
      );

    if (
      previousLength ===
      data.memories.length
    ) {
      return {
        ok: false,
        code: "memory-not-found",
        message:
          "找不到这条记忆。"
      };
    }

    this.commit();

    return {
      ok: true
    };
  }

  clearAll() {
    this.ensureLoaded()
      .memories = [];

    this.commit();

    return {
      ok: true
    };
  }

  retrieve({
    query = "",
    limit,
    minPriority
  } = {}) {
    const settings =
      this.getMemorySettings();

    if (!settings.enabled) {
      return [];
    }

    const resolvedLimit =
      Math.max(
        0,
        Math.min(
          Number.isFinite(
            Number(limit)
          )
            ? Math.round(
                Number(limit)
              )
            : settings.maxInjected,
          50
        )
      );

    const resolvedMinimum =
      clampPriority(
        minPriority,
        settings.minPriority
      );

    if (resolvedLimit === 0) {
      return [];
    }

    const selected =
      this.ensureLoaded()
        .memories
        .filter(
          (memory) =>
            memory.enabled &&
            memory.priority >=
              resolvedMinimum
        )
        .map((memory) => ({
          memory,
          score:
            relevanceScore(
              memory,
              query
            ) +
            memory.priority * 10
        }))
        .sort(
          (left, right) =>
            right.score -
              left.score ||
            right.memory.updatedAt -
              left.memory.updatedAt
        )
        .slice(0, resolvedLimit)
        .map(({ memory }) =>
          memory
        );

    if (selected.length > 0) {
      const usedAt =
        this.now();
      const selectedIds =
        new Set(
          selected.map(
            (memory) =>
              memory.id
          )
        );

      for (
        const memory
        of this.ensureLoaded()
          .memories
      ) {
        if (
          selectedIds.has(
            memory.id
          )
        ) {
          memory.lastUsedAt =
            usedAt;
        }
      }

      this.store.save(
        this.data
      );
    }

    return selected.map(clone);
  }

  getMemorySettings() {
    const settings =
      this.getSettings();

    return {
      enabled:
        settings
          ?.memory
          ?.enabled ?? true,
      maxInjected:
        settings
          ?.memory
          ?.maxInjected ?? 5,
      minPriority:
        settings
          ?.memory
          ?.minPriority ??
        settings
          ?.memory
          ?.minImportance ??
        0.3
    };
  }

  reconcileSettings() {
    this.ensureLoaded();

    return this.getState();
  }

  commit() {
    this.data =
      this.store.save(
        this.data
      );

    this.onChange(
      this.getState()
    );
  }
}
