import crypto from "node:crypto";

import {
  MEMORY_CATEGORIES,
  createMemoryKey,
  normalizeMemoryContent
} from "./memorySchema.js";

function clone(value) {
  return structuredClone(value);
}

function clampImportance(
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

function normalizeCategory(
  value,
  fallback = "other"
) {
  return MEMORY_CATEGORIES.includes(
    value
  )
    ? value
    : fallback;
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

  const normalizedContent =
    memory.content
      .toLocaleLowerCase();

  let score = 0;

  if (
    normalizedContent.includes(
      normalizedQuery
    ) ||
    normalizedQuery.includes(
      normalizedContent
    )
  ) {
    score += 20;
  }

  const queryTokens =
    tokenize(normalizedQuery);

  const contentTokens =
    tokenize(normalizedContent);

  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      score += 8;
    }
  }

  return score;
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
              minImportance: 0.3
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
      categories:
        Object.fromEntries(
          MEMORY_CATEGORIES.map(
            (category) => [
              category,
              memories.filter(
                (memory) =>
                  memory.category ===
                  category
              ).length
            ]
          )
        )
    };
  }

  list({
    query = "",
    category = "all",
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
          category !== "all" &&
          memory.category !==
            category
        ) {
          return false;
        }

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
          memory.content
            .toLocaleLowerCase()
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
    category = "other",
    content,
    importance = 0.5,
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

    const data =
      this.ensureLoaded();

    const normalizedCategory =
      normalizeCategory(category);

    const key =
      createMemoryKey({
        category:
          normalizedCategory,
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
      duplicate.content =
        normalizedContent;
      duplicate.importance =
        clampImportance(
          importance,
          duplicate.importance
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
      category:
        normalizedCategory,
      content:
        normalizedContent,
      importance:
        clampImportance(
          importance
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

    const nextCategory =
      patch.category ===
        undefined
        ? memory.category
        : normalizeCategory(
            patch.category,
            memory.category
          );

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

    const nextKey =
      createMemoryKey({
        category:
          nextCategory,
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
      duplicate.importance =
        patch.importance ===
          undefined
          ? Math.max(
              duplicate.importance,
              memory.importance
            )
          : clampImportance(
              patch.importance,
              duplicate.importance
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

    memory.category =
      nextCategory;
    memory.content =
      nextContent;

    if (
      patch.importance !==
      undefined
    ) {
      memory.importance =
        clampImportance(
          patch.importance,
          memory.importance
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
    minImportance
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
      clampImportance(
        minImportance,
        settings.minImportance
      );

    if (resolvedLimit === 0) {
      return [];
    }

    return this.ensureLoaded()
      .memories
      .filter(
        (memory) =>
          memory.enabled &&
          memory.importance >=
            resolvedMinimum
      )
      .map((memory) => ({
        memory,
        score:
          relevanceScore(
            memory,
            query
          ) +
          memory.importance * 10
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
        clone(memory)
      );
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
      minImportance:
        settings
          ?.memory
          ?.minImportance ?? 0.3
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
