import {
  isActivityEventVisible
} from "../utils/taskActivity.js";

export function planStatusMark(status) {
  if (status === "completed") {
    return "✓";
  }

  if (["blocked", "needs_input"].includes(status)) {
    return "!";
  }

  if (["skipped", "cancelled", "superseded"].includes(status)) {
    return "–";
  }

  return "";
}

export function panelTimelineEvents(snapshot, developerMode = false) {
  return snapshot.events.filter((event) => {
    if (!isActivityEventVisible(event, { developerMode })) {
      return false;
    }

    if (["summary", "batch"].includes(event.type)) {
      return false;
    }

    if (event.type !== "status") {
      return true;
    }

    return developerMode ||
      ["failed", "cancelled", "interrupted", "attention"].includes(event.status);
  });
}

