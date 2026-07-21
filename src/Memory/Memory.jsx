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
} from "../shared/hooks/useWindowMaximized.js";

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

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import "./Memory.css";

function searchText(memory) {
  return [
    memory.description,
    ...(memory.tags ?? []),
    memory.title,
    memory.content
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

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
  const [filter, setFilter] =
    useState("all");
  const [editorDirty, setEditorDirty] =
    useState(false);
  const [
    sidebarCollapsed,
    setSidebarCollapsed
  ] = useState(false);

  const filteredMemories =
    useMemo(() => {
      const normalized =
        query
          .trim()
          .toLocaleLowerCase();

      return library.memories.filter(
        (memory) => {
          const matchesFilter =
            filter === "all" ||
            (
              filter === "enabled" &&
              memory.enabled
            ) ||
            (
              filter === "disabled" &&
              !memory.enabled
            );

          return (
            matchesFilter &&
            (
              !normalized ||
              searchText(memory)
                .includes(
                  normalized
                )
            )
          );
        }
      );
    }, [
      filter,
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

  const canLeaveEditor = () => {
    return (
      !editorDirty ||
      window.confirm(
        "当前修改尚未保存，确定放弃吗？"
      )
    );
  };

  const startCreate = () => {
    if (!canLeaveEditor()) {
      return;
    }

    setSelectedId(null);
    setCreating(true);
    setEditorDirty(false);
    library.clearError();
  };

  const createMemory =
    async (input) => {
      const result =
        await library.create(input);

      if (result?.ok) {
        setCreating(false);
        setEditorDirty(false);
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
        setEditorDirty(false);
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
        setEditorDirty(false);
      }

      return result;
    };

  const closeWindow = () => {
    if (!canLeaveEditor()) {
      return;
    }

    window.api
      ?.closeWindow?.();
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
          sidebarCollapsed
            ? "is-sidebar-collapsed"
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
        ...getWindowTypographyStyle(
          settings,
          "memory"
        ),

        "--memory-accent":
          settings.appearance
            .accentColor
      }}
    >
      <MemoryTopbar
        sidebarCollapsed={
          sidebarCollapsed
        }
        isMaximized={isMaximized}
        onToggleSidebar={() => {
          setSidebarCollapsed(
            (current) =>
              !current
          );
        }}
        onCreate={startCreate}
        onMinimize={() => {
          window.api
            ?.minimizeWindow?.();
        }}
        onMaximize={() => {
          window.api
            ?.maximizeWindow?.();
        }}
        onClose={closeWindow}
      />

      <div className="memory-layout">
        <MemorySidebar
          memories={filteredMemories}
          selectedId={selectedId}
          query={query}
          filter={filter}
          loading={library.loading}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onSelect={(id) => {
            if (!canLeaveEditor()) {
              return;
            }

            setSelectedId(id);
            setCreating(false);
            setEditorDirty(false);
            library.clearError();
          }}
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
            onDirtyChange={
              setEditorDirty
            }
            onCreate={createMemory}
            onUpdate={updateMemory}
            onDelete={deleteMemory}
            onCancelCreate={() => {
              if (!canLeaveEditor()) {
                return;
              }

              setCreating(false);
              setEditorDirty(false);
            }}
          />
        </section>
      </div>
    </div>
  );
}
