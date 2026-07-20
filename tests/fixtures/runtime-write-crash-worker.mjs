import fs from "node:fs";
import path from "node:path";

import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";

const [root, runtimeRoot, boundary] = process.argv.slice(2);
fs.mkdirSync(root, { recursive: true });

const session = createAgentToolSession({
  taskId: `task-${boundary}`,
  runId: `run-${boundary}`,
  workspaceId: `workspace-${boundary}`,
  segmentId: "segment-1",
  resultStoreDirectory: runtimeRoot,
  faultInjector: async (currentBoundary) => {
    if (currentBoundary === boundary) {
      fs.writeFileSync(
        path.join(root, "crash-boundary.txt"),
        currentBoundary,
        "utf8"
      );
      process.exit(87);
    }
  },
  settings: {
    tools: {
      mode: "coding",
      runtime: {
        journalMaxFileBytes: 256_000,
        journalMaxArchives: 3,
        journalMaxTotalBytes: 1_000_000
      },
      workspace: {
        roots: [root],
        maxWriteFileBytes: 1_000_000
      },
      developer: {
        toolsetOverrides: {},
        toolOverrides: {}
      }
    }
  }
});

await session.tools.write_text_file.execute(
  {
    path: "effect.txt",
    content: `value-${boundary}\n`,
    createDirectories: false
  },
  { toolCallId: `call-${boundary}` }
);

await session.closePersistence();
process.exit(0);
