"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, Loader2, Play, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FlowVariableDeclaration } from "@/lib/flows/runtime-primitives";
import { useFlowEditor } from "./flow-editor-state";

interface DebugSession {
  id: string;
  revision: number;
  variables: Record<string, unknown>;
  source_run_id?: string | null;
  status: string;
}

interface DebugExecution {
  id: string;
  node_key: string;
  node_type?: string;
  status: string;
  inputs?: unknown;
  outputs?: unknown;
  error?: unknown;
  simulated_effects?: unknown[];
  duration_ms?: number;
  attempt?: number;
}

interface SourceRun {
  id: string;
  status: string;
  started_at?: string;
}

export function FlowDebugPanel() {
  const t = useTranslations("Flows.debug");
  const {
    flow,
    state,
    selectedNodeKey,
    setSelectedNodeKey,
  } = useFlowEditor();
  const [open, setOpen] = useState(false);
  const [sourceRuns, setSourceRuns] = useState<SourceRun[]>([]);
  const [sourceRunId, setSourceRunId] = useState("");
  const [session, setSession] = useState<DebugSession | null>(null);
  const [executions, setExecutions] = useState<DebugExecution[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedExecution = useMemo(
    () =>
      executions.find(
        (execution) => execution.node_key === selectedNodeKey,
      ) ?? null,
    [executions, selectedNodeKey],
  );

  const loadFlightRecorder = useCallback(async () => {
    const response = await fetch(
      `/api/flows/${flow.id}/debug/flight-recorder`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(t("loadError"));
    const body = (await response.json()) as {
      runs?: SourceRun[];
      executions?: DebugExecution[];
    };
    setSourceRuns(body.runs ?? []);
    if (!session) setExecutions(body.executions ?? []);
  }, [flow.id, session, t]);

  const loadSession = useCallback(
    async (id: string) => {
      const response = await fetch(
        `/api/flows/${flow.id}/debug/sessions/${id}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("loadError"));
      const body = (await response.json()) as {
        session: DebugSession;
        executions: DebugExecution[];
      };
      setSession(body.session);
      setExecutions(body.executions ?? []);
    },
    [flow.id, t],
  );

  useEffect(() => {
    if (!open) return;
    void loadFlightRecorder().catch(() => setMessage(t("loadError")));
  }, [loadFlightRecorder, open, t]);

  async function createSession() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/flows/${flow.id}/debug/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        session?: DebugSession;
        error?: string;
      };
      if (!response.ok || !body.session) {
        throw new Error(body.error ?? t("createError"));
      }
      setSession(body.session);
      setExecutions([]);
      setMessage(t("sessionReady"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("createError"));
    } finally {
      setBusy(false);
    }
  }

  async function editVariable(
    declaration: FlowVariableDeclaration,
    raw: unknown,
  ) {
    if (
      !session ||
      declaration.type === "contact" ||
      declaration.type === "message"
    ) {
      return;
    }
    let value = raw;
    if (declaration.type === "boolean") value = raw === true || raw === "true";
    setBusy(true);
    try {
      const response = await fetch(
        `/api/flows/${flow.id}/debug/sessions/${session.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_revision: session.revision,
            variables: { [declaration.key]: value },
          }),
        },
      );
      if (response.status === 409) {
        await loadSession(session.id);
        setMessage(t("conflictReloaded"));
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        session?: DebugSession;
        error?: string;
      };
      if (!response.ok || !body.session) {
        throw new Error(body.error ?? t("editError"));
      }
      setSession(body.session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("editError"));
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedNode() {
    if (!session || !selectedNodeKey) return;
    if (!window.confirm(t("confirmSimulation"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/flows/${flow.id}/debug/sessions/${session.id}/nodes/${encodeURIComponent(selectedNodeKey)}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_revision: session.revision,
            overrides: {},
          }),
        },
      );
      if (response.status === 409) {
        await loadSession(session.id);
        setMessage(t("conflictReloaded"));
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        session?: DebugSession;
        execution?: DebugExecution;
        error?: string;
      };
      if (!response.ok || !body.session || !body.execution) {
        throw new Error(body.error ?? t("runError"));
      }
      setSession(body.session);
      setExecutions((current) => [body.execution!, ...current]);
      setMessage(t("runComplete"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("runError"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
      >
        <Bug className="h-4 w-4" />
        {t("open")}
      </Button>
    );
  }

  return (
    <aside
      aria-label={t("title")}
      className="border-border bg-card flex h-full w-[340px] shrink-0 flex-col border-l"
    >
      <header className="border-border flex items-center gap-2 border-b p-3">
        <Bug className="text-primary h-4 w-4" />
        <h2 className="flex-1 text-sm font-semibold">{t("title")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          {t("simulationNotice")}
        </p>

        <section className="space-y-2">
          <label className="text-xs font-medium" htmlFor="debug-source-run">
            {t("sourceRun")}
          </label>
          <select
            id="debug-source-run"
            value={sourceRunId}
            onChange={(event) => setSourceRunId(event.target.value)}
            className="border-border bg-muted w-full rounded-md border px-2 py-2 text-xs"
          >
            <option value="">{t("newSession")}</option>
            {sourceRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.status} · {run.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            onClick={createSession}
            disabled={busy}
            className="w-full"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("startSession")}
          </Button>
        </section>

        {session ? (
          <>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold">{t("variables")}</h3>
              {state.variable_schema.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("noVariables")}
                </p>
              ) : (
                state.variable_schema.map((declaration) => (
                  <VariableEditor
                    key={declaration.key}
                    declaration={declaration}
                    value={session.variables[declaration.key]}
                    disabled={busy}
                    onCommit={(value) => editVariable(declaration, value)}
                  />
                ))
              )}
            </section>

            <section className="space-y-2">
              <label className="text-xs font-medium" htmlFor="debug-node">
                {t("selectedNode")}
              </label>
              <select
                id="debug-node"
                value={selectedNodeKey ?? ""}
                onChange={(event) =>
                  setSelectedNodeKey(event.target.value || null)
                }
                className="border-border bg-muted w-full rounded-md border px-2 py-2 text-xs"
              >
                <option value="">{t("selectNode")}</option>
                {state.nodes.map((node) => (
                  <option key={node.node_key} value={node.node_key}>
                    {node.node_key} · {node.node_type}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                onClick={runSelectedNode}
                disabled={!selectedNodeKey || busy}
                className="w-full"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t("runNode")}
              </Button>
            </section>

            <ExecutionDetails execution={selectedExecution} />
          </>
        ) : (
          <p className="text-muted-foreground text-xs">{t("emptySession")}</p>
        )}
      </div>

      <div
        aria-live="polite"
        className="border-border text-muted-foreground min-h-10 border-t p-3 text-xs"
      >
        {message}
        {message ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              session
                ? void loadSession(session.id)
                : void loadFlightRecorder()
            }
            aria-label={t("retry")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

function VariableEditor({
  declaration,
  value,
  disabled,
  onCommit,
}: {
  declaration: FlowVariableDeclaration;
  value: unknown;
  disabled: boolean;
  onCommit: (value: unknown) => void;
}) {
  const readOnly =
    declaration.type === "contact" || declaration.type === "message";
  if (declaration.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 text-xs">
        <code>{declaration.key}</code>
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled || readOnly}
          onChange={(event) => onCommit(event.target.checked)}
        />
      </label>
    );
  }
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : value === undefined
        ? ""
        : JSON.stringify(value);
  return (
    <label className="block space-y-1 text-xs">
      <span>
        <code>{declaration.key}</code> · {declaration.type}
      </span>
      <Input
        defaultValue={text}
        disabled={disabled || readOnly}
        readOnly={readOnly}
        onBlur={(event) => onCommit(event.target.value)}
        aria-label={declaration.key}
        className="bg-muted font-mono text-xs"
      />
    </label>
  );
}

function ExecutionDetails({
  execution,
}: {
  execution: DebugExecution | null;
}) {
  const t = useTranslations("Flows.debug");
  if (!execution) {
    return (
      <p className="text-muted-foreground text-xs">{t("noExecution")}</p>
    );
  }
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold">{t("lastExecution")}</h3>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        <dt>{t("status")}</dt>
        <dd>{execution.status}</dd>
        <dt>{t("duration")}</dt>
        <dd>{execution.duration_ms ?? 0} ms</dd>
        <dt>{t("attempt")}</dt>
        <dd>{execution.attempt ?? 1}</dd>
      </dl>
      {(["inputs", "outputs", "error", "simulated_effects"] as const).map(
        (field) => (
          <details key={field}>
            <summary className="cursor-pointer text-xs font-medium">
              {t(field === "simulated_effects" ? "simulatedEffects" : field)}
            </summary>
            <pre className="bg-muted mt-1 max-h-40 overflow-auto rounded p-2 text-[10px]">
              {JSON.stringify(execution[field] ?? null, null, 2)}
            </pre>
          </details>
        ),
      )}
    </section>
  );
}
