import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  useAppSettings
} from "../shared/hooks/useAppSettings.js";

import {
  useResolvedTheme
} from "../shared/hooks/useResolvedTheme.js";

import {
  useWindowMaximized
} from "../Conversation/hooks/useWindowMaximized.js";

import {
  MemoryEditor
} from "./components/Editor.jsx";

import {
  MemorySidebar
} from "./components/Sidebar.jsx";

import {
  MemoryTopbar
} from "./components/Topbar.jsx";

import {
  useMemoryLibrary
} from "./hooks/useMemoryLibrary.js";

import "./Memory.css";

export default function Memory() {
  const settings =
    useAppSettings();
  const theme =
    useResolvedTheme(
      settings.appearance.theme
    );
  const isMaximized =
    useWindowMaximized();
  const library =
    useMemoryLibrary();

  const [selectedId, setSelectedId] =
    useState(null);
  const [creating, setCreating] =
    useState(false);
  const [query, setQuery] =
    useState("");
  const [category, setCategory] =
    useState("all");

  const filteredMemories =
    useMemo(() => {
      const normalized =
        query
          .trim()
          .toLocaleLowerCase();

      return library.memories.filter(
        (memory) => {
          return (
            (category === "all" ||
              memory.category ===
                category) &&
            (!normalized ||
              memory.content
                .toLocaleLowerCase()
                .includes(
                  normalized
                ))
          );
        }
      );
    }, [
      category,
      library.memories,
      query
    ]);

  const selectedMemory =
    library.memories.find(
      (memory) =>
        memory.id === selectedId
    ) ?? null;

  useEffect(() => {
    if (creating) {
      return;
    }

    if (
      selectedId &&
      library.memories.some(
        (memory) =>
          memory.id === selectedId
      )
    ) {
      return;
    }

    setSelectedId(
      library.memories[0]?.id ??
      null
    );
  }, [
    creating,
    library.memories,
    selectedId
  ]);

  const startCreate = () => {
    setSelectedId(null);
    setCreating(true);
    library.clearError();
  };

  const createMemory =
    async (input) => {
      const result =
        await library.create(input);

      if (result?.ok) {
        setCreating(false);
        setSelectedId(
          result.memory?.id ??
          null
        );
      }

      return result;
    };

  const updateMemory =
    async (id, patch) => {
      const result =
        await library.update(
          id,
          patch
        );

      if (
        result?.ok &&
        result.memory?.id
      ) {
        setSelectedId(
          result.memory.id
        );
      }

      return result;
    };

  const deleteMemory =
    async (id) => {
      const result =
        await library.remove(id);

      if (result?.ok) {
        setSelectedId(null);
        setCreating(false);
      }

      return result;
    };

  return (
    <div
      className={
        [
          "memory-shell",
          theme === "dark"
            ? "theme-dark"
            : "",
          isMaximized
            ? "is-maximized"
            : "",
          settings.appearance
            .reducedMotion
            ? "reduce-motion"
            : ""
        ]
          .filter(Boolean)
          .join(" ")
      }
      data-testid="memory-window"
      style={{
        "--memory-accent":
          settings.appearance
            .accentColor
      }}
    >
      <MemoryTopbar
        state={library.state}
        isMaximized={isMaximized}
        onNew={startCreate}
        onMinimize={() => {
          window.api
            ?.minimizeWindow?.();
        }}
        onMaximize={() => {
          window.api
            ?.maximizeWindow?.();
        }}
        onClose={() => {
          window.api
            ?.closeWindow?.();
        }}
      />

      <div className="memory-layout">
        <MemorySidebar
          memories={filteredMemories}
          selectedId={selectedId}
          query={query}
          category={category}
          loading={library.loading}
          onQueryChange={setQuery}
          onCategoryChange={
            setCategory
          }
          onSelect={(id) => {
            setSelectedId(id);
            setCreating(false);
            library.clearError();
          }}
          onNew={startCreate}
        />

        <section className="memory-main">
          {library.error && (
            <div className="memory-alert">
              {library.error}
            </div>
          )}

          <MemoryEditor
            memory={selectedMemory}
            creating={creating}
            busy={library.busy}
            onCreate={createMemory}
            onUpdate={updateMemory}
            onDelete={deleteMemory}
            onCancelCreate={() => {
              setCreating(false);
            }}
          />
        </section>
      </div>
    </div>
  );
}
