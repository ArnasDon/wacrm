import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/flows/flow-debug-panel.tsx"),
  "utf8",
);
const client = readFileSync(
  join(process.cwd(), "src/components/flows/flow-debug-client.ts"),
  "utf8",
);
const editorState = readFileSync(
  join(process.cwd(), "src/components/flows/flow-editor-state.tsx"),
  "utf8",
);
const canvas = readFileSync(
  join(process.cwd(), "src/components/flows/flow-canvas.tsx"),
  "utf8",
);
const en = JSON.parse(
  readFileSync(join(process.cwd(), "messages/en.json"), "utf8"),
);
const ko = JSON.parse(
  readFileSync(join(process.cwd(), "messages/ko.json"), "utf8"),
);

describe("flow debug inspector UI", () => {
  it("shares selected node state between the inspector and canvas", () => {
    expect(editorState).toContain("selectedNodeKey");
    expect(editorState).toContain("setSelectedNodeKey");
    expect(canvas).not.toContain(
      "const [selectedNodeKey, setSelectedNodeKey] = useState",
    );
    expect(source).toContain("setSelectedNodeKey");
    expect(source).toContain("key={`${declaration.key}:${session.revision}`}");
  });

  it("offers source runs, typed variables and explicit simulation-only execution", () => {
    expect(client).toContain("/debug/flight-recorder");
    expect(client).toContain("/debug/sessions");
    expect(source).toContain("expected_revision");
    expect(source).toContain("window.confirm");
    expect(source).toContain("contact");
    expect(source).toContain("message");
    expect(source).toContain("aria-live");
    expect(source).toContain("session.manifest.variable_schema");
    expect(source).toContain("session.manifest.nodes");
    expect(source).toContain("overrides");
    expect(source).toContain("flightExecutions");
    expect(source).toContain("debugExecutions");
    expect(source).toContain("availableSessions");
    expect(source).toContain("closeDebugSession");
    expect(source).toContain("fetchFlightExecutionDetail");
    expect(source).toContain("fetchDebugExecutionDetail");
    expect(source).toContain("selectedFlightDetail");
    expect(source).toContain("selectedDebugDetail");
    expect(source).not.toContain("selectedFlightExecution");
    expect(source).not.toContain("state.variable_schema");
    expect(source).not.toContain("state.nodes");
  });

  it("renders sanitized execution metadata with the lazy debug detail", () => {
    expect(client).toContain("metadata?: unknown");
    expect(source).toContain(
      '["inputs", "outputs", "error", "simulated_effects", "metadata"]',
    );
    expect(en.Flows.debug.metadata).toBe("Metadata");
    expect(ko.Flows.debug.metadata).toBeTruthy();
  });

  it("keeps invalid typed overrides local and disables execution", () => {
    expect(source).toContain("setOverrideErrors");
    expect(source).toContain("hasOverrideErrors");
    expect(source).toContain("raw.trim()");
    expect(source).not.toContain("onChange(Number(raw))");
    expect(source).toContain(
      "disabled={!selectedManifestNode || busy || hasOverrideErrors}",
    );
  });

  it("reconciles historical selection against the pinned session manifest", () => {
    expect(source).toContain(
      "session.manifest.nodes.some((node) => node.node_key === selectedNodeKey)",
    );
    expect(source).toContain(
      "setSelectedNodeKey(session.manifest.nodes[0]?.node_key ?? null)",
    );
    expect(source).not.toContain("disabled={!selectedNodeKey || busy}");
  });

  it("ships real English and Korean debug translations", () => {
    expect(en.Flows.debug.simulationNotice).toContain("never");
    expect(ko.Flows.debug.simulationNotice).toContain("실제");
    expect(Object.keys(ko.Flows.debug).sort()).toEqual(
      Object.keys(en.Flows.debug).sort(),
    );
  });

  it("is mounted only for the flow owner capability", () => {
    const shell = readFileSync(
      join(process.cwd(), "src/components/flows/flow-editor-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("canManageVersions && <FlowDebugPanel />");
  });
});
