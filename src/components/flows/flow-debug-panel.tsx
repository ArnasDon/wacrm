"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, Loader2, Play, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FlowVariableDeclaration } from "@/lib/flows/runtime-primitives";
import {
  closeDebugSession,
  fetchDebugSessions,
  fetchFlightRecorder,
  FlowDebugClientError,
  resumeDebugSession,
  type DebugExecution,
  type DebugManifestPort,
  type DebugSession,
  type DebugSessionSummary,
  type FlightRecorderPage,
  type SourceRun,
} from "./flow-debug-client";
import { useFlowEditor } from "./flow-editor-state";

export function FlowDebugPanel() {
  const t = useTranslations("Flows.debug");
  const { flow, selectedNodeKey, setSelectedNodeKey } = useFlowEditor();
  const [open, setOpen] = useState(false);
  const [sourceRuns, setSourceRuns] = useState<SourceRun[]>([]);
  const [sourceRunId, setSourceRunId] = useState("");
  const [availableSessions, setAvailableSessions] = useState<
    DebugSessionSummary[]
  >([]);
  const [session, setSession] = useState<DebugSession | null>(null);
  const [debugExecutions, setDebugExecutions] = useState<DebugExecution[]>([]);
  const [flightExecutions, setFlightExecutions] = useState<DebugExecution[]>(
    [],
  );
  const [flightPage, setFlightPage] = useState<FlightRecorderPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [overrideErrors, setOverrideErrors] = useState<Record<string, string>>(
    {},
  );
  const hasOverrideErrors = Object.keys(overrideErrors).length > 0;

  const selectedExecution = useMemo(
    () =>
      debugExecutions.find(
        (execution) => execution.node_key === selectedNodeKey,
      ) ?? null,
    [debugExecutions, selectedNodeKey],
  );
  const selectedFlightExecution = useMemo(
    () =>
      flightExecutions.find(
        (execution) => execution.node_key === selectedNodeKey,
      ) ??
      flightExecutions[0] ??
      null,
    [flightExecutions, selectedNodeKey],
  );
  const selectedManifestNode = useMemo(
    () =>
      session?.manifest.nodes.find(
        (node) => node.node_key === selectedNodeKey,
      ) ?? null,
    [selectedNodeKey, session],
  );

  useEffect(() => {
    setOverrides({});
    setOverrideErrors({});
  }, [selectedNodeKey, session?.id]);

  useEffect(() => {
    if (!session) return;
    if (
      !session.manifest.nodes.some((node) => node.node_key === selectedNodeKey)
    ) {
      setSelectedNodeKey(session.manifest.nodes[0]?.node_key ?? null);
    }
  }, [selectedNodeKey, session, setSelectedNodeKey]);

  const loadFlightRecorder = useCallback(
    async (runId?: string, cursor?: string) => {
      const body = await fetchFlightRecorder(fetch, flow.id, {
        ...(runId ? { runId } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 25,
      });
      if (!runId) setSourceRuns(body.runs);
      setFlightExecutions((current) =>
        cursor ? [...current, ...body.executions] : body.executions,
      );
      setFlightPage(body.page);
    },
    [flow.id],
  );

  const loadSessions = useCallback(async () => {
    setAvailableSessions(await fetchDebugSessions(fetch, flow.id));
  }, [flow.id]);

  const loadSession = useCallback(
    async (id: string) => {
      const body = await resumeDebugSession(fetch, flow.id, id);
      setSession(body.session);
      setDebugExecutions(body.executions);
      setAvailableSessions((current) =>
        current.map((candidate) =>
          candidate.id === body.session.id ? body.session : candidate,
        ),
      );
    },
    [flow.id],
  );

  const recoverSession = useCallback(
    async (sessionId: string) => {
      try {
        await loadSession(sessionId);
        setMessage(t("conflictReloaded"));
      } catch (error) {
        if (
          error instanceof FlowDebugClientError &&
          (error.status === 404 || error.status === 410)
        ) {
          setSession(null);
          setDebugExecutions([]);
          await loadSessions();
          setMessage(t("sessionUnavailable"));
          return;
        }
        throw error;
      }
    },
    [loadSession, loadSessions, t],
  );

  useEffect(() => {
    if (!open) return;
    void Promise.all([loadFlightRecorder(), loadSessions()]).catch(() =>
      setMessage(t("loadError")),
    );
  }, [loadFlightRecorder, loadSessions, open, t]);

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
      setDebugExecutions([]);
      await loadSessions();
      setMessage(t("sessionReady"));
    } catch (error) {
      await loadSessions().catch(() => undefined);
      setMessage(error instanceof Error ? error.message : t("createError"));
    } finally {
      setBusy(false);
    }
  }

  async function endSession(candidate: DebugSessionSummary) {
    setBusy(true);
    setMessage(null);
    try {
      await closeDebugSession(fetch, flow.id, candidate.id, candidate.revision);
      if (session?.id === candidate.id) {
        setSession(null);
        setDebugExecutions([]);
      }
      await loadSessions();
      setMessage(t("sessionClosed"));
    } catch (error) {
      if (
        error instanceof FlowDebugClientError &&
        (error.status === 404 || error.status === 409 || error.status === 410)
      ) {
        if (session?.id === candidate.id) {
          await recoverSession(candidate.id).catch(() => undefined);
        }
        await loadSessions().catch(() => undefined);
        setMessage(
          error.status === 409
            ? t("conflictReloaded")
            : t("sessionUnavailable"),
        );
      } else {
        setMessage(error instanceof Error ? error.message : t("closeError"));
      }
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
        await recoverSession(session.id);
        return;
      }
      if (response.status === 404 || response.status === 410) {
        await recoverSession(session.id);
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
    if (
      !session ||
      !selectedNodeKey ||
      !selectedManifestNode ||
      hasOverrideErrors
    ) {
      return;
    }
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
            overrides,
          }),
        },
      );
      if (response.status === 409) {
        await recoverSession(session.id);
        return;
      }
      if (response.status === 404 || response.status === 410) {
        await recoverSession(session.id);
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
      setDebugExecutions((current) => [body.execution!, ...current]);
      void loadSessions();
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
            onChange={(event) => {
              const nextRunId = event.target.value;
              setSourceRunId(nextRunId);
              void loadFlightRecorder(nextRunId || undefined).catch(() =>
                setMessage(t("loadError")),
              );
            }}
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

        <section className="space-y-2">
          <h3 className="text-xs font-semibold">{t("existingSessions")}</h3>
          {availableSessions.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("noExistingSessions")}
            </p>
          ) : (
            <ul className="space-y-2">
              {availableSessions.map((candidate) => (
                <li
                  key={candidate.id}
                  className="border-border flex items-center gap-2 rounded-md border p-2 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    <code>{candidate.id.slice(0, 8)}</code> · {candidate.status}
                  </span>
                  {candidate.status === "active" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void loadSession(candidate.id)
                            .then(() => setMessage(t("sessionResumed")))
                            .catch(async (error) => {
                              if (
                                error instanceof FlowDebugClientError &&
                                (error.status === 404 || error.status === 410)
                              ) {
                                await loadSessions();
                                setMessage(t("sessionUnavailable"));
                                return;
                              }
                              setMessage(t("loadError"));
                            })
                            .finally(() => setBusy(false));
                        }}
                      >
                        {t("resumeSession")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void endSession(candidate)}
                      >
                        {t("endSession")}
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-label={t("flightRecorder")}>
          <h3 className="text-xs font-semibold">{t("flightRecorder")}</h3>
          {flightExecutions.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("noProductionExecutions")}
            </p>
          ) : (
            <>
              <ul className="space-y-1">
                {flightExecutions.map((execution) => (
                  <li key={execution.id}>
                    <button
                      type="button"
                      className="border-border hover:bg-muted flex w-full items-center justify-between rounded border px-2 py-1 text-left text-xs"
                      onClick={() => setSelectedNodeKey(execution.node_key)}
                    >
                      <code>{execution.node_key}</code>
                      <span>
                        {execution.status} · #{execution.attempt ?? 1}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {flightPage?.truncated && flightPage.next_cursor ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void loadFlightRecorder(
                      sourceRunId || undefined,
                      flightPage.next_cursor ?? undefined,
                    ).catch(() => setMessage(t("loadError")))
                  }
                  className="w-full"
                >
                  {t("loadMoreExecutions")}
                </Button>
              ) : null}
              <ExecutionDetails execution={selectedFlightExecution} />
            </>
          )}
        </section>

        {session ? (
          <>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold">{t("variables")}</h3>
              {session.manifest.variable_schema.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("noVariables")}
                </p>
              ) : (
                session.manifest.variable_schema.map((declaration) => (
                  <VariableEditor
                    key={`${declaration.key}:${session.revision}`}
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
                {session.manifest.nodes.map((node) => (
                  <option key={node.node_key} value={node.node_key}>
                    {node.node_key} · {node.node_type}
                  </option>
                ))}
              </select>
              {selectedManifestNode?.inputs.map((port) => (
                <DebugOverrideEditor
                  key={`${session.id}:${selectedManifestNode.node_key}:${port.id}`}
                  port={port}
                  disabled={busy}
                  error={overrideErrors[port.id]}
                  onChange={(value) => {
                    setOverrides((current) => ({
                      ...current,
                      [port.id]: value,
                    }));
                    setOverrideErrors((current) => {
                      const next = { ...current };
                      delete next[port.id];
                      return next;
                    });
                  }}
                  onError={(error) =>
                    setOverrideErrors((current) => ({
                      ...current,
                      [port.id]: error,
                    }))
                  }
                />
              ))}
              <Button
                type="button"
                size="sm"
                onClick={runSelectedNode}
                disabled={!selectedManifestNode || busy || hasOverrideErrors}
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
                : void Promise.all([loadFlightRecorder(), loadSessions()])
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

function DebugOverrideEditor({
  port,
  disabled,
  error,
  onChange,
  onError,
}: {
  port: DebugManifestPort;
  disabled: boolean;
  error?: string;
  onChange: (value: unknown) => void;
  onError: (error: string) => void;
}) {
  if (port.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>
          {port.label} <code>{port.id}</code>
        </span>
        <input
          type="checkbox"
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={port.label}
        />
      </label>
    );
  }
  return (
    <label className="block space-y-1 text-xs">
      <span>
        {port.label} <code>{port.id}</code> · {port.type}
        {port.required ? " *" : ""}
      </span>
      <Input
        disabled={disabled}
        aria-label={port.label}
        aria-invalid={!!error}
        className="bg-muted font-mono text-xs"
        onBlur={(event) => {
          const raw = event.target.value;
          if (port.type === "number") {
            if (!raw.trim()) {
              onError("A number is required.");
              return;
            }
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) {
              onError("Enter a finite number.");
              return;
            }
            onChange(parsed);
            return;
          }
          if (port.type === "json") {
            try {
              onChange(JSON.parse(raw));
            } catch {
              onError("Enter valid JSON.");
            }
            return;
          }
          if (port.type === "any") {
            try {
              onChange(JSON.parse(raw));
            } catch {
              onChange(raw);
            }
            return;
          }
          onChange(raw);
        }}
      />
      {error ? (
        <span className="text-destructive text-[10px]">{error}</span>
      ) : null}
    </label>
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

function ExecutionDetails({ execution }: { execution: DebugExecution | null }) {
  const t = useTranslations("Flows.debug");
  if (!execution) {
    return <p className="text-muted-foreground text-xs">{t("noExecution")}</p>;
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
