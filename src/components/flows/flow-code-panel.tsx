"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  acceptCanvasCode,
  acceptEditedCode,
  createFlowCodeEditorState,
  editFlowCode,
  keepEditedCode,
  receiveCanvasCode,
  withFlowCodeDiagnostics,
  type FlowCodeEditorDiagnostic,
  type FlowCodeEditorState,
} from "./flow-code-editor";
import { useFlowEditor, type BuilderState } from "./flow-editor-state";
import type { BuilderNode, NodeType } from "./shared";
import { Button } from "@/components/ui/button";

const MAX_FILE_BYTES = 1024 * 1024;

interface PreviewDraft {
  name: string;
  description: string | null;
  trigger_type: BuilderState["trigger_type"];
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: BuilderState["fallback_policy"];
  variable_schema: BuilderState["variable_schema"];
  nodes: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
    position_x: number;
    position_y: number;
  }>;
}

interface PreviewResponse {
  normalized: string;
  digest: string;
  issues: FlowCodeEditorDiagnostic[];
  draft: PreviewDraft;
  secret_requirements: Array<{
    name: string;
    node_key: string;
    path: string;
  }>;
}

function draftToBuilderState(
  current: BuilderState,
  draft: PreviewDraft,
): BuilderState {
  return {
    ...current,
    name: draft.name,
    description: draft.description ?? "",
    trigger_type: draft.trigger_type,
    trigger_config: draft.trigger_config,
    entry_node_id: draft.entry_node_id,
    fallback_policy: draft.fallback_policy,
    variable_schema: draft.variable_schema,
    nodes: draft.nodes.map(
      (node): BuilderNode => ({
        node_key: node.node_key,
        node_type: node.node_type as NodeType,
        config: node.config,
        position_x: node.position_x,
        position_y: node.position_y,
      }),
    ),
  };
}

export function FlowCodePanel() {
  const t = useTranslations("Flows.code");
  const { flow, state, setState, draftRevision } = useFlowEditor();
  const [controller, setController] = useState<FlowCodeEditorState | null>(null);
  const controllerRef = useRef(controller);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<{
    text: string;
    digest: string;
    secretRequirements: PreviewResponse["secret_requirements"];
  } | null>(null);
  const [resourceBindings, setResourceBindings] = useState<
    Record<string, string>
  >({});
  const uploadRef = useRef<HTMLInputElement>(null);
  const secretsFormRef = useRef<HTMLFormElement>(null);
  const controllerReady = controller !== null;

  useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/flows/${flow.id}/export`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("export_failed");
        const text = await response.text();
        const digest = response.headers.get("etag")?.replaceAll('"', "") ?? "";
        if (!cancelled) setController(createFlowCodeEditorState(text, digest));
      })
      .catch(() => {
        if (!cancelled) toast.error(t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flow.id, t]);

  // Canvas/list changes are normalized on the server so account-scoped ids
  // never enter the code textarea. A pending code edit wins until the user
  // explicitly resolves the surfaced conflict.
  useEffect(() => {
    if (!controllerReady) return;
    const timeout = window.setTimeout(() => {
      void fetch(`/api/flows/${flow.id}/export/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as {
            normalized: string;
            digest: string;
          };
        })
        .then((result) => {
          if (!result) return;
          setController((current) =>
            current
              ? receiveCanvasCode(current, result.normalized, result.digest)
              : current,
          );
        });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [controllerReady, flow.id, state]);

  // Code is parsed+resolved after a short pause. Invalid or unresolved code
  // only updates diagnostics; BuilderState is replaced atomically once the
  // exact submitted text returns a valid compiled draft.
  useEffect(() => {
    if (
      !controller ||
      controller.editedText === controller.canonicalText ||
      controller.conflict
    ) {
      return;
    }
    const submitted = controller.editedText;
    const timeout = window.setTimeout(() => {
      void fetch("/api/flows/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: submitted,
          resource_bindings: resourceBindings,
        }),
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as
            | PreviewResponse
            | { code?: string };
          if (!response.ok || !("draft" in payload)) {
            return {
              error: [
                {
                  code:
                    "code" in payload && payload.code
                      ? payload.code
                      : "IMPORT_PREVIEW_FAILED",
                  severity: "fatal" as const,
                },
              ],
            };
          }
          return { preview: payload };
        })
        .then((result) => {
          if (!result || controllerRef.current?.editedText !== submitted) return;
          if ("error" in result && result.error) {
            setController((current) =>
              current
                ? withFlowCodeDiagnostics(current, result.error)
                : current,
            );
            return;
          }
          const blocking = result.preview.issues.some(
            (issue) =>
              issue.severity === "fatal" || issue.severity === "blocking",
          );
          setPendingPreview({
            text: submitted,
            digest: result.preview.digest,
            secretRequirements: result.preview.secret_requirements,
          });
          if (blocking) {
            setController((current) =>
              current
                ? withFlowCodeDiagnostics(current, result.preview.issues)
                : current,
            );
            return;
          }
          setState((current) =>
            draftToBuilderState(current, result.preview.draft),
          );
          setController((current) =>
            current
              ? acceptEditedCode(
                  withFlowCodeDiagnostics(current, result.preview.issues),
                  result.preview.normalized,
                  result.preview.digest,
                )
              : current,
          );
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [controller, resourceBindings, setState]);

  if (loading || !controller) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  const download = () => {
    const blob = new Blob([controller.editedText], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${flow.name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "flow"}.wacrm-flow.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t("tooLarge"));
      return;
    }
    const text = await file.text();
    setController((current) =>
      current ? editFlowCode(current, text) : current,
    );
  };

  const saveCode = async () => {
    setSavingCode(true);
    try {
      const document =
        pendingPreview?.text === controller.editedText
          ? controller.editedText
          : controller.canonicalText;
      const previewDigest =
        pendingPreview?.text === document
          ? pendingPreview.digest
          : controller.digest;
      let bindingToken: string | undefined;
      if ((pendingPreview?.secretRequirements.length ?? 0) > 0) {
        if (!secretsFormRef.current) throw new Error("SECRET_REQUIRED");
        const formData = new FormData(secretsFormRef.current);
        if (
          pendingPreview!.secretRequirements.some(
            ({ name }) => !String(formData.get(name) ?? ""),
          )
        ) {
          throw new Error("SECRET_REQUIRED");
        }
        const sidecarResponse = await fetch("/api/flows/import/secrets", {
          method: "POST",
          body: formData,
        });
        const sidecarPayload = (await sidecarResponse
          .json()
          .catch(() => ({}))) as { binding_token?: string; code?: string };
        if (!sidecarResponse.ok || !sidecarPayload.binding_token) {
          throw new Error(
            sidecarPayload.code ?? "INVALID_SECRET_SIDECAR",
          );
        }
        bindingToken = sidecarPayload.binding_token;
      }
      const response = await fetch(`/api/flows/${flow.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document,
          preview_digest: previewDigest,
          expected_draft_revision: draftRevision,
          ...(bindingToken ? { binding_token: bindingToken } : {}),
          ...(Object.keys(resourceBindings).length > 0
            ? { resource_bindings: resourceBindings }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (!response.ok) throw new Error(payload.code ?? "IMPORT_FAILED");
      toast.success(t("saved"));
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSavingCode(false);
    }
  };

  return (
    <section
      aria-label={t("title")}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <strong className="text-sm">{t("title")}</strong>
        <span className="text-xs text-muted-foreground">{t("schema")}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            ref={uploadRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label={t("upload")}
            onChange={upload}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t("upload")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("download")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              savingCode ||
              controller.conflict ||
              controller.diagnostics.some(
                (issue) =>
                  issue.severity === "fatal" ||
                  (issue.severity === "blocking" &&
                    issue.code !== "SECRET_REQUIRED"),
              )
            }
            onClick={saveCode}
          >
            {savingCode ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      {controller.conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
        >
          <span>{t("conflict")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setController((current) =>
                current ? acceptCanvasCode(current) : current,
              )
            }
          >
            {t("useCanvas")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setController((current) =>
                current
                  ? keepEditedCode(current)
                  : current,
              )
            }
          >
            {t("useCode")}
          </Button>
        </div>
      )}

      <label htmlFor="flow-code-editor" className="sr-only">
        {t("editorLabel")}
      </label>
      <textarea
        id="flow-code-editor"
        value={controller.editedText}
        spellCheck={false}
        onChange={(event) =>
          setController((current) =>
            current ? editFlowCode(current, event.target.value) : current,
          )
        }
        className="min-h-0 flex-1 resize-none bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {(pendingPreview?.secretRequirements.length ?? 0) > 0 && (
        <form
          ref={secretsFormRef}
          aria-label={t("secrets")}
          className="max-h-40 overflow-y-auto border-t border-border px-3 py-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <p className="mb-2 text-xs text-muted-foreground">
            {t("secretsNotice")}
          </p>
          <div className="grid gap-2">
            {pendingPreview!.secretRequirements.map((requirement) => (
              <label key={requirement.name} className="grid gap-1 text-xs">
                <span>{requirement.name}</span>
                <input
                  type="password"
                  name={requirement.name}
                  required
                  autoComplete="off"
                  className="h-8 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            ))}
          </div>
        </form>
      )}

      {controller.diagnostics.length > 0 && (
        <ul
          aria-label={t("diagnostics")}
          className="max-h-28 overflow-y-auto border-t border-border px-3 py-2 text-xs"
        >
          {controller.diagnostics.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              className={
                issue.severity === "warning"
                  ? "text-amber-600"
                  : "text-destructive"
              }
            >
              <span>
                {issue.code}
                {issue.message ? ` — ${issue.message}` : ""}
              </span>
              {issue.code === "RESOURCE_AMBIGUOUS" &&
                issue.path?.startsWith("resources.") &&
                issue.candidates &&
                issue.candidates.length > 0 && (
                  <select
                    aria-label={t("chooseResource")}
                    value={
                      resourceBindings[
                        issue.path.slice("resources.".length)
                      ] ?? ""
                    }
                    onChange={(event) => {
                      const ref = issue.path!.slice("resources.".length);
                      setResourceBindings((current) => ({
                        ...current,
                        [ref]: event.target.value,
                      }));
                    }}
                    className="ml-2 h-7 rounded border border-border bg-background px-2 text-foreground"
                  >
                    <option value="">{t("chooseResource")}</option>
                    {issue.candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
