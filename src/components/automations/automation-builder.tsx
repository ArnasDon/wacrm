"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  MousePointerClick,
  List,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  InteractiveMessagePayload,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Tag as TagRecord,
} from "@/types"
import {
  InteractiveBuilder,
  blankButtonsPayload,
  blankListPayload,
} from "@/components/interactive/interactive-builder"
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import {
  findStepByCid,
  findStepContextByCid,
  fromServerSteps as mapServerSteps,
  insertStep,
  moveStepByCid,
  removeStepByCid,
  toApiSteps,
  updateStepByCid,
  type BranchTarget,
  type BuilderStep,
  type ServerStepNode,
  type StepContext,
} from "./automation-tree"

import { AutomationCanvas } from "./automation-canvas"

export type { BuilderStep, ServerStepNode } from "./automation-tree"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: {
    label: "send_message",
    icon: MessageSquare,
    border: "border-l-primary",
  },
  send_buttons: {
    label: "send_buttons",
    icon: MousePointerClick,
    border: "border-l-primary",
  },
  send_list: { label: "send_list", icon: List, border: "border-l-primary" },
  send_template: {
    label: "send_template",
    icon: FileText,
    border: "border-l-primary",
  },
  add_tag: { label: "add_tag", icon: Tag, border: "border-l-primary" },
  remove_tag: {
    label: "remove_tag",
    icon: TagIcon,
    border: "border-l-primary",
  },
  assign_conversation: {
    label: "assign_conversation",
    icon: UserCheck,
    border: "border-l-primary",
  },
  update_contact_field: {
    label: "update_contact_field",
    icon: PencilLine,
    border: "border-l-primary",
  },
  create_deal: {
    label: "create_deal",
    icon: Briefcase,
    border: "border-l-primary",
  },
  wait: { label: "wait", icon: Hourglass, border: "border-l-border" },
  condition: {
    label: "condition",
    icon: GitBranch,
    border: "border-l-amber-500",
  },
  send_webhook: {
    label: "send_webhook",
    icon: Webhook,
    border: "border-l-primary",
  },
  close_conversation: {
    label: "close_conversation",
    icon: CircleSlash,
    border: "border-l-primary",
  },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: "new_message_received" },
  { value: "first_inbound_message" },
  { value: "keyword_match" },
  { value: "interactive_reply" },
  { value: "new_contact_created" },
  { value: "conversation_assigned" },
  { value: "tag_added" },
  { value: "time_based" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

// The send_buttons / send_list step_config IS an InteractiveMessagePayload,
// but step_config is typed generically as Record<string, unknown>. These two
// helpers hold the single unavoidable structural cast in one place so a
// payload-shape change has one seam to update instead of four scattered
// `as unknown as` sites.
function toStepConfig(p: InteractiveMessagePayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>
}
function asInteractive(
  cfg: Record<string, unknown>
): InteractiveMessagePayload {
  return cfg as unknown as InteractiveMessagePayload
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_buttons":
      return toStepConfig(blankButtonsPayload())
    case "send_list":
      return toStepConfig(blankListPayload())
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates, pipelines)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
}

interface PipelineOption {
  id: string
  name: string
}

interface PipelineStageOption {
  id: string
  name: string
  pipeline_id: string
  position: number
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { tags } = useResources()
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t("tags.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = tags.find((t) => t.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="border-border h-3 w-3 shrink-0 rounded-full border"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("tags.select")}</option>
        {tags.map((tg) => (
          <option key={tg.id} value={tg.id}>
            {tg.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{t("tags.unknown", { id: value })}</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">{t("fields.name")}</option>
      <option value="email">{t("fields.email")}</option>
      <option value="company">{t("fields.company")}</option>
      {customFields.length > 0 && (
        <optgroup label={t("fields.customFields")}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>
          {t("fields.unknown", { id: customValue })}
        </option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { members } = useResources()
  if (members.length === 0) {
    return (
      <Input
        placeholder={t("agents.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">{t("agents.select")}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("agents.unknown", { id: value })}</option>
      )}
    </select>
  )
}

/** Pipeline + stage picker for Create Deal. The automation stores ids because
 *  the engine writes directly to deals, but authors should choose by name. */
function DealPipelineFields({
  pipelineId,
  stageId,
  onChange,
  t,
}: {
  pipelineId: string
  stageId: string
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { pipelines, stages } = useResources()

  if (pipelines.length === 0) {
    return (
      <>
        <FieldBlock label={t("pipelines.pipelineIdLabel")}>
          <Input
            value={pipelineId}
            onChange={(e) =>
              onChange({ pipeline_id: e.target.value, stage_id: stageId })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("pipelines.stageIdLabel")}>
          <Input
            value={stageId}
            onChange={(e) =>
              onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((s) => s.id === stageId)

  return (
    <>
      <FieldBlock label={t("pipelines.pipelineLabel")}>
        <select
          value={pipelineId}
          onChange={(e) => {
            const nextPipelineId = e.target.value
            const firstStage = stages.find(
              (s) => s.pipeline_id === nextPipelineId
            )
            onChange({
              pipeline_id: nextPipelineId,
              stage_id: firstStage?.id ?? "",
            })
          }}
          className={SELECT_CLASS}
        >
          <option value="">{t("pipelines.selectPipeline")}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pipelineId && !selectedPipeline && (
            <option value={pipelineId}>
              {t("pipelines.unknownPipeline", { id: pipelineId })}
            </option>
          )}
        </select>
      </FieldBlock>
      <FieldBlock label={t("pipelines.stageLabel")}>
        <select
          value={stageId}
          onChange={(e) =>
            onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
          }
          className={SELECT_CLASS}
          disabled={!pipelineId || stageOptions.length === 0}
        >
          <option value="">
            {pipelineId
              ? t("pipelines.selectStage")
              : t("pipelines.selectPipelineFirst")}
          </option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {stageId && pipelineId && !selectedStage && (
            <option value={stageId}>
              {t("pipelines.unknownStage", { id: stageId })}
            </option>
          )}
        </select>
      </FieldBlock>
    </>
  )
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
  t,
}: {
  templateName: string
  language: string
  onChange: (patch: { template_name: string; language: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { templates } = useResources()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t("templates.templateNameLabel")}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("templates.languageLabel")}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({
                template_name: templateName,
                language: e.target.value,
              })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some(
    (t) => toValue(t.name, t.language ?? "en_US") === current
  )

  return (
    <FieldBlock label={t("templates.templateLabel")}>
      <select
        value={current}
        onChange={(e) => {
          const [name, lang] = e.target.value.split("::")
          onChange({ template_name: name ?? "", language: lang ?? "" })
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t("templates.select")}</option>
        {templates.map((tmpl) => {
          const lang = tmpl.language ?? "en_US"
          return (
            <option key={tmpl.id} value={toValue(tmpl.name, lang)}>
              {tmpl.name} ({lang})
            </option>
          )
        })}
        {current && !hasMatch && (
          <option value={current}>
            {t("templates.unknown", {
              name: templateName,
              lang: language || t("templates.unknownLang"),
            })}
          </option>
        )}
      </select>
    </FieldBlock>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const t = useTranslations("Automations.builder")
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () => (selectedId ? findStepContextByCid(state.steps, selectedId) : null),
    [selectedId, state.steps]
  )

  function patchTop<K extends keyof BuilderInitial>(
    key: K,
    value: BuilderInitial[K]
  ) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(cid: string, updater: (s: BuilderStep) => BuilderStep) {
    if (!findStepByCid(state.steps, cid)) {
      toast.error(t("tree.nodeNotFound"))
      return
    }
    setState((current) => {
      const mutation = updateStepByCid(current.steps, cid, updater)
      return { ...current, steps: mutation.steps }
    })
  }

  function addStepAt(
    parent: BranchTarget,
    index: number,
    type: AutomationStepType
  ) {
    if (
      parent.kind === "branch" &&
      !findStepByCid(state.steps, parent.parentCid)?.branches
    ) {
      toast.error(t("tree.branchNotFound"))
      return
    }
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
    }
    setState((current) => {
      const mutation = insertStep(current.steps, parent, index, node)
      return { ...current, steps: mutation.steps }
    })
    setSelectedId(node.cid)
  }

  function deleteStep(cid: string) {
    if (!findStepByCid(state.steps, cid)) {
      toast.error(t("tree.nodeNotFound"))
      return
    }
    setState((current) => {
      const mutation = removeStepByCid(current.steps, cid)
      return { ...current, steps: mutation.steps }
    })
    setSelectedId((current) => (current === cid ? null : current))
  }

  function moveStep(cid: string, direction: -1 | 1) {
    setState((current) => {
      const mutation = moveStepByCid(current.steps, cid, direction)
      return mutation.changed ? { ...current, steps: mutation.steps } : current
    })
  }

  function updateStepPosition(cid: string, x: number, y: number) {
    updateStep(cid, (step) => ({ ...step, position: { x, y } }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? t("toasts.saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("toasts.saved") : t("toasts.created"))
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="border-border bg-card/80 flex flex-shrink-0 items-center gap-2 border-b px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md transition-colors"
          aria-label={t("backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("untitled")}
          className="text-foreground placeholder:text-muted-foreground focus:bg-muted min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold focus:outline-none sm:text-base"
        />
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="hidden sm:inline">{t("active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label={t("activeAria")}
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("save") : t("saveDraft")}
        </Button>
      </header>

      <ResourcesProvider>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="border-border bg-card hidden w-80 shrink-0 overflow-x-hidden overflow-y-auto border-r p-4 lg:block">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-foreground text-sm font-semibold">
                  Workflow setup
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Add a step, then configure it on the canvas.
                </p>
              </div>
              <AddButton
                onPick={(type) =>
                  addStepAt({ kind: "root" }, state.steps.length, type)
                }
              />
            </div>
            <div className="border-border bg-muted/20 rounded-xl border p-3">
              <TriggerCard
                type={state.trigger_type}
                config={state.trigger_config}
                onTypeChange={(tVal) => patchTop("trigger_type", tVal)}
                onConfigChange={(c) => patchTop("trigger_config", c)}
                t={t}
              />
            </div>
          </aside>

          <main className="relative min-w-0 flex-1">
            <div className="absolute top-3 left-3 z-10 lg:hidden">
              <AddButton
                onPick={(type) =>
                  addStepAt({ kind: "root" }, state.steps.length, type)
                }
              />
            </div>
            <AutomationCanvas
              steps={state.steps}
              selectedCid={selectedId}
              onSelectStep={setSelectedId}
              onDeleteStep={deleteStep}
              onUpdateStepPosition={updateStepPosition}
            />
          </main>

          {selected && (
            <AutomationInspector
              context={selected}
              onClose={() => setSelectedId(null)}
              onChange={(next) => updateStep(selected.step.cid, () => next)}
              onMove={(direction) => moveStep(selected.step.cid, direction)}
              onDelete={() => deleteStep(selected.step.cid)}
            />
          )}
        </div>
      </ResourcesProvider>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
  t,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const [open, setOpen] = useState(false)
  return (
    // The trigger lives in both the canvas and its narrower configuration
    // rail. It must shrink with its parent rather than force a 320px card
    // into an inner, padded column and get clipped.
    <div className="z-10 w-full min-w-0">
      <div className="border-border bg-card rounded-lg border border-l-4 border-l-blue-500 shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tracking-wide text-blue-300 uppercase">
              {t("trigger")}
            </div>
            <div className="text-foreground truncate text-sm font-medium">
              {t(`triggers.${type}.label`)}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "text-muted-foreground h-4 w-4 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
        {open && (
          <div className="border-border space-y-3 border-t px-4 py-3">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("triggerType")}
              </label>
              <select
                value={type}
                onChange={(e) =>
                  onTypeChange(e.target.value as AutomationTriggerType)
                }
                className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(`triggers.${o.value}.label`)}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {t(`triggers.${type}.hint`)}
              </p>
            </div>
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
                t={t}
              />
            )}
            {type === "interactive_reply" && (
              <InteractiveReplyConfig
                config={config}
                onChange={onConfigChange}
                t={t}
              />
            )}
            {type === "tag_added" && (
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Tag
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ""}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                  t={t}
                />
              </div>
            )}
            {type === "time_based" && (
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t("schedule")}
                </label>
                <Input
                  placeholder="Cron expression or HH:mm"
                  value={(config.schedule as string) ?? ""}
                  onChange={(e) =>
                    onConfigChange({ ...config, schedule: e.target.value })
                  }
                  className="bg-muted text-foreground"
                />
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {t("scheduleHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
  t,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const keywords = config?.keywords ?? []
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join(", "))

  // Persist the default the <select> displays. The dropdown falls back to
  // "contains" for display, but leaving it untouched would otherwise omit
  // match_type from the saved config — and activation validation then
  // rejected it (trigger.match_type). Seed once on mount; the component
  // remounts when the trigger type changes, matching the keywords draft.
  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: "contains" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t("keywords")}
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          placeholder={t("keywordsHint")}
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t("config.matchType")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) =>
            onChange({
              ...config,
              match_type: e.target.value as "exact" | "contains",
            })
          }
          className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
        >
          <option value="contains">{t("config.matchContains")}</option>
          <option value="exact">{t("config.matchExact")}</option>
        </select>
      </div>
    </div>
  )
}

function InteractiveReplyConfig({
  config,
  onChange,
  t,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const ids = (config?.reply_ids as string[] | undefined) ?? []
  // Same local-draft-then-commit pattern as KeywordMatchConfig so
  // commas + spaces survive keystrokes.
  const [draft, setDraft] = useState(ids.join(", "))

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, reply_ids: parsed })
  }

  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs font-medium">
        {t("replyIds")}
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={t("replyIdsHint")}
        className="bg-muted text-foreground font-mono"
      />
      <p className="text-muted-foreground mt-1 text-[11px]">
        {t("replyIdsHelp")}
      </p>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

interface StepListProps {
  steps: BuilderStep[]
  target: BranchTarget
  selectedId: string | null
  onSelect: (cid: string) => void
  addStepAt: (
    target: BranchTarget,
    index: number,
    type: AutomationStepType
  ) => void
}

function StepList(props: StepListProps) {
  const { steps, target } = props

  return (
    <div className="flex w-max min-w-[320px] flex-col items-center">
      <AddButton onPick={(type) => props.addStepAt(target, 0, type)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          target={target}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          addStepAt={props.addStepAt}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  target,
  selectedId,
  onSelect,
  addStepAt,
}: {
  step: BuilderStep
  index: number
  target: BranchTarget
  selectedId: string | null
  onSelect: (cid: string) => void
  addStepAt: StepListProps["addStepAt"]
}) {
  const t = useTranslations("Automations.builder")
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const isCondition = step.step_type === "condition"
  const selected = selectedId === step.cid

  return (
    <>
      <div
        data-automation-node={step.cid}
        className={cn(
          "z-10 flex flex-col items-center",
          isCondition ? "w-max min-w-[400px]" : "w-80"
        )}
      >
        <div
          className={cn(
            "border-border bg-card rounded-lg border border-l-4 shadow-lg transition-[box-shadow,border-color]",
            isCondition ? "w-[400px]" : "w-80",
            meta.border,
            selected && "border-primary ring-primary/30 ring-2"
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
            aria-pressed={selected}
          >
            <GripVertical
              className="text-muted-foreground h-4 w-4 flex-shrink-0"
              aria-hidden
            />
            <div className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-md">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {isCondition
                  ? "Condition"
                  : step.step_type === "wait"
                    ? "Wait"
                    : "Action"}
              </div>
              <div className="text-foreground truncate text-sm font-medium">
                {t(`steps.${meta.label}`)}
              </div>
              <div className="text-muted-foreground truncate text-[11px]">
                {previewFor(step)}
              </div>
            </div>
            <ChevronDown
              className={cn(
                "text-muted-foreground h-4 w-4 transition-transform",
                selected && "text-primary -rotate-90"
              )}
            />
          </button>
        </div>

        {isCondition && (
          <ConditionBranches
            step={step}
            selectedId={selectedId}
            onSelect={onSelect}
            addStepAt={addStepAt}
          />
        )}
      </div>

      {/* A condition branches into Yes/No (rendered above by
          ConditionBranches), so it has no linear "continue" path — adding
          the trailing connector here would produce a spurious third output. */}
      {!isCondition && (
        <AddButton onPick={(type) => addStepAt(target, index + 1, type)} />
      )}
    </>
  )
}

function ConditionBranches({
  step,
  selectedId,
  onSelect,
  addStepAt,
}: {
  step: BuilderStep
  selectedId: string | null
  onSelect: (cid: string) => void
  addStepAt: StepListProps["addStepAt"]
}) {
  const t = useTranslations("Automations.builder")
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  return (
    <div className="mt-3 grid w-max grid-cols-2 gap-12">
      <BranchColumn label={t("branches.yes")} color="text-primary">
        <StepList
          steps={yes}
          target={{ kind: "branch", parentCid: step.cid, branch: "yes" }}
          selectedId={selectedId}
          onSelect={onSelect}
          addStepAt={addStepAt}
        />
      </BranchColumn>
      <BranchColumn label={t("branches.no")} color="text-rose-400">
        <StepList
          steps={no}
          target={{ kind: "branch", parentCid: step.cid, branch: "no" }}
          selectedId={selectedId}
          onSelect={onSelect}
          addStepAt={addStepAt}
        />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-[320px] flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>
        {label}
      </div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  const t = useTranslations("Automations.builder")
  return (
    <div className="relative flex flex-col items-center">
      <div className="bg-border h-4 w-[2px]" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed transition-colors"
          aria-label={t("addStep")}
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="border-border bg-popover max-h-80 min-w-56 overflow-y-auto"
        >
          {ADDABLE_STEPS.map((tp) => {
            const Icon = STEP_META[tp].icon
            return (
              <DropdownMenuItem key={tp} onClick={() => onPick(tp)}>
                <Icon className="h-4 w-4" />
                {t(`steps.${STEP_META[tp].label}`)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="bg-border h-4 w-[2px]" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function AutomationInspector({
  context,
  onClose,
  onChange,
  onMove,
  onDelete,
}: {
  context: StepContext
  onClose: () => void
  onChange: (step: BuilderStep) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}) {
  const t = useTranslations("Automations.builder")
  const meta = STEP_META[context.step.step_type]
  const Icon = meta.icon

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/45 md:static md:z-20 md:w-[440px] md:shrink-0 md:bg-transparent">
      <button
        type="button"
        className="absolute inset-0 md:hidden"
        onClick={onClose}
        aria-label={t("canvas.closeInspector")}
      />
      <aside className="border-border bg-card relative flex h-full w-[min(100vw,440px)] flex-col border-l shadow-2xl md:shadow-none">
        <div className="border-border flex items-center gap-3 border-b px-4 py-3">
          <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {context.step.step_type === "condition"
                ? t("inspector.condition")
                : t("inspector.action")}
            </div>
            <h2 className="text-foreground truncate text-sm font-semibold">
              {t(`steps.${meta.label}`)}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("canvas.closeInspector")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <StepEditor step={context.step} onChange={onChange} />
        </div>

        <div className="border-border flex items-center justify-between gap-2 border-t px-4 py-3">
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={context.index === 0}
              aria-label={t("inspector.moveUp")}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={context.index === context.total - 1}
              aria-label={t("inspector.moveDown")}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("delete")}
          </Button>
        </div>
      </aside>
    </div>
  )
}

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useTranslations("Automations.builder")
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label={t("config.messageText")}>
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t("config.placeholderMessageText")}
            className="bg-muted text-foreground min-h-24"
          />
        </FieldBlock>
      )
    case "send_buttons":
    case "send_list":
      // The whole step_config IS the interactive payload; the shared
      // builder edits it in place (and enforces Meta's limits + preview).
      return (
        <InteractiveBuilder
          value={asInteractive(cfg)}
          layout="stacked"
          onChange={(payload) =>
            onChange({ ...step, step_config: toStepConfig(payload) })
          }
        />
      )
    case "send_template":
      return (
        <SendTemplateFields
          templateName={(cfg.template_name as string) ?? ""}
          language={(cfg.language as string) ?? ""}
          onChange={(patch) => set(patch)}
          t={t}
        />
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("config.tagLabel")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
            t={t}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("config.modeLabel")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="round_robin">
                {t("config.modes.round_robin")}
              </option>
              <option value="specific">{t("config.modes.specific")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("config.agentLabel")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
                t={t}
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("config.fieldLabel")}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
              t={t}
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t("config.placeholderValue")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ""}
            stageId={(cfg.stage_id as string) ?? ""}
            onChange={(patch) => set(patch)}
            t={t}
          />
          <FieldBlock label={t("config.titleLabel")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t("config.amountLabel")}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) =>
                set({ amount: Math.max(1, Number(e.target.value)) })
              }
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.unitLabel")}>
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="minutes">{t("config.units.minutes")}</option>
              <option value="hours">{t("config.units.hours")}</option>
              <option value="days">{t("config.units.days")}</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return (
        <>
          <FieldBlock label={t("config.subjectLabel")}>
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="tag_presence">
                {t("config.subjects.tag_presence")}
              </option>
              <option value="contact_field">
                {t("config.subjects.contact_field")}
              </option>
              <option value="message_content">
                {t("config.subjects.message_content")}
              </option>
              <option value="time_of_day">
                {t("config.subjects.time_of_day")}
              </option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("config.operandLabel")}>
            <Input
              placeholder={
                cfg.subject === "time_of_day"
                  ? t("config.placeholderTime")
                  : cfg.subject === "contact_field"
                    ? t("config.placeholderContact")
                    : cfg.subject === "tag_presence"
                      ? t("config.placeholderTag")
                      : ""
              }
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          {(cfg.subject === "contact_field" ||
            cfg.subject === "message_content") && (
            <FieldBlock label="Value">
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    case "send_webhook":
      return (
        <>
          <FieldBlock label={t("config.urlLabel")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.bodyTemplateLabel")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="bg-muted text-foreground min-h-20 font-mono text-xs"
            />
          </FieldBlock>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-muted-foreground text-xs">
          {t("config.closeConversationHint", {
            defaultValue:
              'Sets the conversation status to "closed". No configuration needed.',
          })}
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "no text yet"
    case "send_buttons":
    case "send_list":
      return (
        interactivePayloadPreviewText(asInteractive(step.step_config)) ||
        "no body yet"
      )
    case "send_template":
      return (step.step_config.template_name as string) || "pick a template"
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return `when ${step.step_config.subject ?? "?"}`
    case "send_webhook":
      return (step.step_config.url as string) || "no url"
    default:
      return ""
  }
}

/** Convert the server tree into client nodes with stable editor ids. */
export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return mapServerSteps(nodes, cid)
}
