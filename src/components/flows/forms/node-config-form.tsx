"use client";

/**
 * Per-node configuration form, dispatched by node_type.
 *
 * One component, ten branches. Each branch renders the inputs that
 * map onto the node's `config` JSONB shape (text + buttons for
 * send_buttons, prompt + var_key for collect_input, etc.) and forwards
 * edits up via `onUpdateConfig`.
 *
 * Why this lives in src/components/flows/forms/ instead of next to
 * the list editor: PR 2 (canvas editing) needs to mount the same
 * form in a side panel when a user clicks a node on the canvas.
 * Keeping the per-node forms here means there's exactly one place
 * where each form's behaviour and validation lives — drift between
 * "what the list editor shows" and "what the canvas side panel
 * shows" becomes impossible.
 *
 * `showAdvanced` is the disclosure that surfaces internal
 * identifiers (node_key, button reply_id, list row reply_id) — owned
 * by the host (NodeCard / SideSheet) so the toggle is rendered
 * outside this form alongside whatever delete/cancel buttons that
 * host wants. The form just reads the boolean and conditionally
 * renders the advanced rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getNodeDescriptor, type NodeFormField } from "@/lib/flows/registry";
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES,
} from "@/lib/storage/upload-media";
import { slugify, type BuilderNode } from "../shared";
import { NextNodeRow, NodeKeySelect, TextRow } from "./fields";

interface NodeConfigFormProps {
  node: BuilderNode;
  allNodes: BuilderNode[];
  showAdvanced: boolean;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}

export function NodeConfigForm({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
}: NodeConfigFormProps) {
  const descriptor = getNodeDescriptor(node.node_type);
  return (
    <>
      <NodeSpecificConfigForm
        node={node}
        allNodes={allNodes}
        showAdvanced={showAdvanced}
        onUpdateConfig={onUpdateConfig}
      />
      {descriptor?.supportsExecutionPolicy &&
        descriptor.runtimeKind !== "trigger" &&
        descriptor.runtimeKind !== "terminal" && (
          <ErrorHandlingSection
            cfg={node.config}
            allNodes={allNodes}
            currentKey={node.node_key}
            onUpdateConfig={onUpdateConfig}
          />
        )}
    </>
  );
}

function NodeSpecificConfigForm({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
}: NodeConfigFormProps) {
  const t = useTranslations("Flows.builder.form");
  const cfg = node.config;
  const form = getNodeDescriptor(node.node_type)?.form;
  if (!form) return null;
  if (form.kind === "fields") {
    return (
      <DescriptorFieldsForm
        fields={form.fields}
        help={form.help}
        cfg={cfg}
        allNodes={allNodes}
        currentKey={node.node_key}
        onUpdateConfig={onUpdateConfig}
      />
    );
  }

  switch (form.component) {
    case "send_buttons":
      return (
        <SendButtonsForm
          cfg={cfg as SendButtonsCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
          t={t}
        />
      );

    case "send_list":
      return (
        <SendListForm
          cfg={cfg as SendListCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
          t={t}
        />
      );

    case "send_media":
      return (
        <SendMediaForm
          cfg={cfg as SendMediaCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "condition":
      return (
        <ConditionForm
          cfg={cfg as ConditionCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "set_tag":
      return (
        <SetTagForm
          cfg={cfg as SetTagCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );
  }
}

interface RetryConfig {
  max_attempts: number;
  interval_ms: number;
  backoff: "fixed" | "exponential";
}

interface DefaultValueConfig {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  value: unknown;
}

function ErrorHandlingSection({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const retry = (cfg.retry as RetryConfig | undefined) ?? {
    max_attempts: 1,
    interval_ms: 0,
    backoff: "fixed",
  };
  const onError =
    cfg.on_error === "fail_branch" || cfg.on_error === "default_value"
      ? cfg.on_error
      : "fail_run";
  const defaultValue = (cfg.default_value as
    DefaultValueConfig | undefined) ?? {
    key: "node_output",
    type: "string",
    value: "",
  };
  const setRetry = (patch: Partial<RetryConfig>) =>
    onUpdateConfig({ retry: { ...retry, ...patch } });

  return (
    <details className="border-border bg-muted/20 rounded-md border p-3">
      <summary className="text-foreground cursor-pointer text-xs font-medium">
        Error handling
      </summary>
      <div className="mt-3 grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-muted-foreground text-xs">
            Attempts
            <Input
              className="bg-muted mt-1"
              type="number"
              min={1}
              max={3}
              value={retry.max_attempts}
              onChange={(event) =>
                setRetry({ max_attempts: event.target.valueAsNumber })
              }
            />
          </label>
          <label className="text-muted-foreground text-xs">
            Interval (ms)
            <Input
              className="bg-muted mt-1"
              type="number"
              min={0}
              max={5_000}
              value={retry.interval_ms}
              onChange={(event) =>
                setRetry({ interval_ms: event.target.valueAsNumber })
              }
            />
          </label>
        </div>
        <label className="text-muted-foreground text-xs">
          Backoff
          <Select
            value={retry.backoff}
            onValueChange={(value) =>
              setRetry({ backoff: value as RetryConfig["backoff"] })
            }
          >
            <SelectTrigger className="bg-muted mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed</SelectItem>
              <SelectItem value="exponential">Exponential</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="text-muted-foreground text-xs">
          Timeout (ms)
          <Input
            className="bg-muted mt-1"
            type="number"
            min={100}
            max={15_000}
            value={typeof cfg.timeout_ms === "number" ? cfg.timeout_ms : 15_000}
            onChange={(event) =>
              onUpdateConfig({ timeout_ms: event.target.valueAsNumber })
            }
          />
        </label>
        <label className="text-muted-foreground text-xs">
          When all attempts fail
          <Select
            value={onError}
            onValueChange={(value) =>
              onUpdateConfig({
                on_error: value,
                error_next_node_key:
                  value === "fail_branch"
                    ? typeof cfg.error_next_node_key === "string"
                      ? cfg.error_next_node_key
                      : ""
                    : undefined,
                default_value:
                  value === "default_value" ? defaultValue : undefined,
              })
            }
          >
            <SelectTrigger className="bg-muted mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fail_run">Fail run</SelectItem>
              <SelectItem value="fail_branch">Follow error branch</SelectItem>
              <SelectItem value="default_value">Use default value</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {onError === "fail_branch" && (
          <div>
            <label className="text-muted-foreground mb-1 block text-xs">
              Error branch
            </label>
            <NodeKeySelect
              value={
                typeof cfg.error_next_node_key === "string"
                  ? cfg.error_next_node_key
                  : null
              }
              nodes={allNodes}
              excludeKey={currentKey}
              onChange={(value) =>
                onUpdateConfig({ error_next_node_key: value ?? "" })
              }
              placeholder="Pick an error node"
            />
          </div>
        )}
        {onError === "default_value" && (
          <DefaultValueFields
            value={defaultValue}
            onChange={(value) => onUpdateConfig({ default_value: value })}
          />
        )}
      </div>
    </details>
  );
}

function DefaultValueFields({
  value,
  onChange,
}: {
  value: DefaultValueConfig;
  onChange: (value: DefaultValueConfig) => void;
}) {
  const serialized =
    typeof value.value === "string"
      ? value.value
      : value.value === null
        ? ""
        : JSON.stringify(value.value);
  return (
    <div className="border-border grid gap-2 rounded-md border p-2">
      <label className="text-muted-foreground text-xs">
        Variable key
        <Input
          className="bg-muted mt-1"
          value={value.key}
          onChange={(event) => onChange({ ...value, key: event.target.value })}
        />
      </label>
      <label className="text-muted-foreground text-xs">
        Value type
        <Select
          value={value.type}
          onValueChange={(nextType) => {
            const type = nextType as DefaultValueConfig["type"];
            const nextValue =
              type === "boolean"
                ? false
                : type === "number"
                  ? 0
                  : type === "object"
                    ? {}
                    : type === "array"
                      ? []
                      : type === "null"
                        ? null
                        : "";
            onChange({ ...value, type, value: nextValue });
          }}
        >
          <SelectTrigger className="bg-muted mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["string", "number", "boolean", "object", "array", "null"].map(
              (type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </label>
      {value.type === "boolean" ? (
        <Select
          value={String(value.value)}
          onValueChange={(next) =>
            onChange({ ...value, value: next === "true" })
          }
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">false</SelectItem>
            <SelectItem value="true">true</SelectItem>
          </SelectContent>
        </Select>
      ) : value.type !== "null" ? (
        <Textarea
          className="bg-muted font-mono text-xs"
          value={serialized}
          onChange={(event) => {
            const raw = event.target.value;
            let next: unknown = raw;
            if (value.type === "number") next = Number(raw);
            if (value.type === "object" || value.type === "array") {
              try {
                next = JSON.parse(raw);
              } catch {
                next = raw;
              }
            }
            onChange({ ...value, value: next });
          }}
          rows={2}
        />
      ) : null}
    </div>
  );
}

function DescriptorFieldsForm({
  fields,
  help,
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  fields: readonly NodeFormField[];
  help?: string;
  cfg: Record<string, unknown>;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) {
    return help ? (
      <p className="text-muted-foreground text-xs">{help}</p>
    ) : null;
  }
  return (
    <>
      {fields.map((field) => {
        const value = cfg[field.key];
        if (field.kind === "next-node") {
          return (
            <NextNodeRow
              key={field.key}
              value={typeof value === "string" ? value : ""}
              allNodes={allNodes}
              currentKey={currentKey}
              onChange={(next) => onUpdateConfig({ [field.key]: next })}
              label={field.label}
            />
          );
        }
        if (field.kind === "text" || field.kind === "textarea") {
          return (
            <TextRow
              key={field.key}
              label={field.label}
              value={typeof value === "string" ? value : ""}
              onChange={(next) => onUpdateConfig({ [field.key]: next })}
              rows={field.kind === "textarea" ? field.rows : undefined}
            />
          );
        }
        if (field.kind === "number") {
          return (
            <div key={field.key}>
              <label className="text-muted-foreground mb-1 block text-xs">
                {field.label}
              </label>
              <Input
                type="number"
                min={field.min}
                value={typeof value === "number" ? value : ""}
                onChange={(event) =>
                  onUpdateConfig({
                    [field.key]: event.target.valueAsNumber,
                  })
                }
              />
            </div>
          );
        }
        return (
          <div key={field.key}>
            <label className="text-muted-foreground mb-1 block text-xs">
              {field.label}
            </label>
            <Select
              value={typeof value === "string" ? value : ""}
              onValueChange={(next) => onUpdateConfig({ [field.key]: next })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </>
  );
}

// ============================================================
// send_buttons
// ============================================================

interface SendButtonsCfg {
  text?: string;
  footer_text?: string;
  buttons?: Array<{ reply_id: string; title: string; next_node_key: string }>;
}

function SendButtonsForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
  t,
}: {
  cfg: SendButtonsCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const buttons = cfg.buttons ?? [];
  const updateButton = (
    idx: number,
    patch: Partial<NonNullable<SendButtonsCfg["buttons"]>[number]>,
  ) => {
    onUpdateConfig({
      buttons: buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const addButton = () =>
    onUpdateConfig({
      buttons: [
        ...buttons,
        {
          reply_id: `btn_${buttons.length + 1}`,
          title: "Option",
          next_node_key: "",
        },
      ],
    });
  const removeButton = (idx: number) =>
    onUpdateConfig({ buttons: buttons.filter((_, i) => i !== idx) });

  return (
    <>
      <TextRow
        label={t("bodyText")}
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <TextRow
        label={t("footerText")}
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-muted-foreground text-xs">
            {t("buttonsHelp")}
          </label>
        </div>
        <div className="flex flex-col gap-3">
          {buttons.map((b, i) => (
            <div
              key={i}
              className={cn(
                "border-border bg-muted/40 grid grid-cols-1 gap-2 rounded-md border p-3",
                showAdvanced
                  ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                  : "md:grid-cols-[2fr_2fr_auto]",
              )}
            >
              {showAdvanced && (
                <Input
                  value={b.reply_id}
                  onChange={(e) =>
                    updateButton(i, {
                      reply_id: slugify(e.target.value, `btn_${i + 1}`),
                    })
                  }
                  placeholder="reply_id"
                  className="bg-muted font-mono text-xs"
                />
              )}
              <Input
                value={b.title}
                onChange={(e) => updateButton(i, { title: e.target.value })}
                placeholder={t("optionTitlePlaceholder")}
                className="bg-muted"
                maxLength={20}
              />
              <NodeKeySelect
                value={b.next_node_key || null}
                nodes={allNodes}
                excludeKey={currentKey}
                onChange={(v) => updateButton(i, { next_node_key: v ?? "" })}
                placeholder={t("nextNodePlaceholder")}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeButton(i)}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {buttons.length < 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={addButton}
            className="mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addButton")}
          </Button>
        )}
      </div>
    </>
  );
}

// ============================================================
// send_list
// ============================================================

interface SendListCfg {
  text?: string;
  button_label?: string;
  footer_text?: string;
  sections?: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

function SendListForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
  t,
}: {
  cfg: SendListCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const sections = cfg.sections ?? [];
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);

  const updateSection = (
    sIdx: number,
    patch: Partial<NonNullable<SendListCfg["sections"]>[number]>,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) => (i === sIdx ? { ...s, ...patch } : s)),
    });
  };
  const addSection = () =>
    onUpdateConfig({
      sections: [
        ...sections,
        {
          title: "",
          rows: [
            {
              reply_id: `row_${totalRows + 1}`,
              title: `Option ${totalRows + 1}`,
              next_node_key: "",
            },
          ],
        },
      ],
    });
  const removeSection = (sIdx: number) =>
    onUpdateConfig({ sections: sections.filter((_, i) => i !== sIdx) });
  const updateRow = (
    sIdx: number,
    rIdx: number,
    patch: Partial<
      NonNullable<SendListCfg["sections"]>[number]["rows"][number]
    >,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: s.rows.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)),
            }
          : s,
      ),
    });
  };
  const addRow = (sIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: [
                ...s.rows,
                {
                  reply_id: `row_${totalRows + 1}`,
                  title: `Option ${totalRows + 1}`,
                  next_node_key: "",
                },
              ],
            }
          : s,
      ),
    });
  const removeRow = (sIdx: number, rIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, rows: s.rows.filter((_, j) => j !== rIdx) } : s,
      ),
    });

  return (
    <>
      <TextRow
        label="Body text"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextRow
          label={t("buttonLabel")}
          value={cfg.button_label ?? ""}
          onChange={(v) => onUpdateConfig({ button_label: v })}
        />
        <TextRow
          label={t("footerText")}
          value={cfg.footer_text ?? ""}
          onChange={(v) => onUpdateConfig({ footer_text: v })}
        />
      </div>

      <div className="mt-2">
        <label className="text-muted-foreground mb-2 block text-xs">
          {t("rowsHelp")}
        </label>
        {sections.map((section, sIdx) => (
          <div
            key={sIdx}
            className="border-border bg-muted/40 mb-3 rounded-md border p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={section.title ?? ""}
                onChange={(e) => updateSection(sIdx, { title: e.target.value })}
                placeholder={t("sectionTitlePlaceholder", { count: sIdx + 1 })}
                className="bg-muted text-xs"
              />
              {sections.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(sIdx)}
                  className="shrink-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label="Remove section"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {section.rows.map((row, rIdx) => (
              <div
                key={rIdx}
                className={cn(
                  "mb-2 grid grid-cols-1 gap-2",
                  showAdvanced
                    ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                    : "md:grid-cols-[2fr_2fr_auto]",
                )}
              >
                {showAdvanced && (
                  <Input
                    value={row.reply_id}
                    onChange={(e) =>
                      updateRow(sIdx, rIdx, {
                        reply_id: slugify(e.target.value, `row_${rIdx + 1}`),
                      })
                    }
                    placeholder="reply_id"
                    className="bg-muted font-mono text-xs"
                  />
                )}
                <Input
                  value={row.title}
                  onChange={(e) =>
                    updateRow(sIdx, rIdx, { title: e.target.value })
                  }
                  placeholder={t("rowTitlePlaceholder")}
                  className="bg-muted"
                  maxLength={24}
                />
                <NodeKeySelect
                  value={row.next_node_key || null}
                  nodes={allNodes}
                  excludeKey={currentKey}
                  onChange={(v) =>
                    updateRow(sIdx, rIdx, { next_node_key: v ?? "" })
                  }
                  placeholder={t("nextNodePlaceholder")}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(sIdx, rIdx)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {totalRows < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(sIdx)}
                className="mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("addRow")}
              </Button>
            )}
          </div>
        ))}
        {/* WhatsApp's interactive-list spec caps sections at 10. Group rows
            by category (Billing / Support / Sales etc.) to give customers a
            scannable menu. */}
        {sections.length < 10 && (
          <Button variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-3.5 w-3.5" />
            {t("addSection")}
          </Button>
        )}
      </div>
    </>
  );
}

// ============================================================
// condition
// ============================================================

interface ConditionCfg {
  subject?: "var" | "tag" | "contact_field";
  subject_key?: string;
  operator?: "equals" | "contains" | "present" | "absent";
  value?: string;
  true_next?: string;
  false_next?: string;
}

interface UserTag {
  id: string;
  name: string;
  color?: string;
}

function ConditionForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  cfg: ConditionCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tags = useUserTags();

  const subject = cfg.subject ?? "var";
  const operator = cfg.operator ?? "equals";
  const showValue = operator === "equals" || operator === "contains";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t("ifLabel")}
          </label>
          <Select
            value={subject}
            onValueChange={(v) =>
              onUpdateConfig({ subject: v as ConditionCfg["subject"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="var">{t("capturedVariable")}</SelectItem>
              <SelectItem value="tag">{t("contactHasTag")}</SelectItem>
              <SelectItem value="contact_field">{t("contactField")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="text-muted-foreground mb-1 block text-xs">
            {subject === "var"
              ? t("varName")
              : subject === "tag"
                ? t("tagLabel")
                : t("fieldLabel")}
          </label>
          {subject === "tag" && tags.length > 0 ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Pick a tag…" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : subject === "contact_field" ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder={t("pickField")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">name</SelectItem>
                <SelectItem value="email">email</SelectItem>
                <SelectItem value="phone">phone</SelectItem>
                <SelectItem value="company">company</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.subject_key ?? ""}
              onChange={(e) => onUpdateConfig({ subject_key: e.target.value })}
              placeholder={
                subject === "var"
                  ? t("varKeyPlaceholder")
                  : t("tagUuidPlaceholder")
              }
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          showValue ? "md:grid-cols-2" : "",
        )}
      >
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t("operatorLabel")}
          </label>
          <Select
            value={operator}
            onValueChange={(v) =>
              onUpdateConfig({ operator: v as ConditionCfg["operator"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="present">{t("isPresent")}</SelectItem>
              <SelectItem value="absent">{t("isAbsent")}</SelectItem>
              <SelectItem value="equals">{t("equals")}</SelectItem>
              <SelectItem value="contains">{t("contains")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showValue && (
          <div>
            <label className="text-muted-foreground mb-1 block text-xs">
              {t("valueLabel")}
            </label>
            <Input
              value={cfg.value ?? ""}
              onChange={(e) => onUpdateConfig({ value: e.target.value })}
              className="bg-muted"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextNodeRow
          value={cfg.true_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ true_next: v })}
          label={t("ifTrueAdvance")}
        />
        <NextNodeRow
          value={cfg.false_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ false_next: v })}
          label={t("ifFalseAdvance")}
        />
      </div>
    </>
  );
}

// ============================================================
// set_tag
// ============================================================

interface SetTagCfg {
  mode?: "add" | "remove";
  tag_id?: string;
  next_node_key?: string;
}

function SetTagForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  cfg: SetTagCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tags = useUserTags();

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t("actionLabel")}
          </label>
          <Select
            value={cfg.mode ?? "add"}
            onValueChange={(v) =>
              onUpdateConfig({ mode: v as SetTagCfg["mode"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="add">{t("addTag")}</SelectItem>
              <SelectItem value="remove">{t("removeTag")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t("tagLabel")}
          </label>
          {tags.length > 0 ? (
            <Select
              value={cfg.tag_id ?? ""}
              onValueChange={(v) => onUpdateConfig({ tag_id: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Pick a tag…" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.tag_id ?? ""}
              onChange={(e) => onUpdateConfig({ tag_id: e.target.value })}
              placeholder={t("tagUuidPlaceholder")}
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t("thenAdvanceTo")}
      />
    </>
  );
}

/**
 * Shared loader for both `condition` (subject=tag) and `set_tag`.
 * Falls back to raw UUID input if the endpoint is absent on older
 * deployments — the form remains authorable in that case.
 */
function useUserTags(): UserTag[] {
  const [tags, setTags] = useState<UserTag[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags").catch(() => null);
        if (!res || !res.ok) return;
        const json = (await res.json()) as { tags?: UserTag[] };
        if (!cancelled) setTags(json.tags ?? []);
      } catch {
        // Tags endpoint absent — caller falls back to raw input.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}

// ============================================================
// send_media
// ============================================================

interface SendMediaCfg {
  media_type?: "image" | "video" | "document";
  media_url?: string;
  caption?: string;
  filename?: string;
  next_node_key?: string;
}

// Mirrors the bucket's allowed_mime_types from migration 016. Kept in
// sync with the storage policy so the picker rejects unsupported files
// before they hit the network rather than failing with a confusing
// Supabase RLS / mime-type error.
const MEDIA_ACCEPT: Record<NonNullable<SendMediaCfg["media_type"]>, string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

const FLOW_MEDIA_BUCKET = "flow-media";

function SendMediaForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  cfg: SendMediaCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const mediaType = cfg.media_type ?? "image";
  const isDocument = mediaType === "document";
  const displayName =
    cfg.filename ||
    (cfg.media_url ? (cfg.media_url.split("/").pop() ?? "") : "");

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MEDIA_MAX_BYTES) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 16 MB.`,
        );
        return;
      }
      setUploading(true);
      try {
        // Account-scoped upload (path `account-<id>/...`) — see
        // uploadAccountMedia + migration 020's flow-media RLS policy.
        const { publicUrl } = await uploadAccountMedia(FLOW_MEDIA_BUCKET, file);
        // Patch all fields in one call so the form doesn't re-render
        // with a half-uploaded state.
        onUpdateConfig({
          media_url: publicUrl,
          filename: file.name,
        });
        toast.success("File uploaded.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [onUpdateConfig],
  );

  const handleClear = () => {
    onUpdateConfig({ media_url: "", filename: "" });
  };

  return (
    <>
      <div>
        <label className="text-muted-foreground mb-1 block text-xs">
          {t("mediaTypeLabel")}
        </label>
        <Select
          value={mediaType}
          onValueChange={(v) => {
            // Changing type clears the existing file — the bucket
            // accepts different MIME sets per type and a previously
            // uploaded PDF can't be sent as an image.
            onUpdateConfig({
              media_type: v as NonNullable<SendMediaCfg["media_type"]>,
              media_url: "",
              filename: "",
            });
          }}
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="image">{t("imageLabel")}</SelectItem>
            <SelectItem value="video">{t("videoLabel")}</SelectItem>
            <SelectItem value="document">{t("documentLabel")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-muted-foreground mb-1 block text-xs">
          {t("fileLabel")}
        </label>
        {cfg.media_url ? (
          <div className="border-border bg-muted flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            <a
              href={cfg.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground min-w-0 flex-1 truncate hover:text-cyan-300"
              title={displayName || cfg.media_url}
            >
              {displayName || cfg.media_url}
            </a>
            <button
              type="button"
              onClick={handleClear}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
              aria-label={t("removeFile")}
              disabled={uploading}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="border-border bg-card text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("uploading")}
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                {t("clickToUpload")}
              </>
            )}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT[mediaType]}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />
      </div>

      <TextRow
        label={t("captionLabel")}
        value={cfg.caption ?? ""}
        onChange={(v) => onUpdateConfig({ caption: v })}
        rows={2}
      />

      {isDocument && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t("filenameLabel")}
          </label>
          <Input
            value={cfg.filename ?? ""}
            onChange={(e) => onUpdateConfig({ filename: e.target.value })}
            placeholder={t("filenamePlaceholder")}
            className="bg-muted text-xs"
          />
        </div>
      )}

      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t("advanceAfterSending")}
      />
    </>
  );
}
