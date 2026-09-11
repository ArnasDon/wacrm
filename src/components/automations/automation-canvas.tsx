"use client"

import { useCallback, useMemo } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  Briefcase,
  CircleSlash,
  FileText,
  GitBranch,
  Hourglass,
  List,
  MessageSquare,
  MousePointerClick,
  PencilLine,
  Tag,
  TagIcon,
  Trash2,
  UserCheck,
  Webhook,
  Zap,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  defaultPositionsForSteps,
  executionConnections,
  type BuilderStep,
} from "./automation-tree"

export interface AutomationCanvasProps {
  steps: BuilderStep[]
  selectedCid?: string | null
  onSelectStep: (cid: string | null) => void
  onDeleteStep: (cid: string) => void
  onUpdateStepPosition: (cid: string, x: number, y: number) => void
}

export function AutomationCanvas(props: AutomationCanvasProps) {
  return (
    <ReactFlowProvider>
      <AutomationCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function AutomationCanvasInner({
  steps,
  selectedCid,
  onSelectStep,
  onDeleteStep,
  onUpdateStepPosition,
}: AutomationCanvasProps) {
  const defaultPositions = useMemo(
    () => defaultPositionsForSteps(steps),
    [steps]
  )
  const nodes = useMemo<Node<AutomationNodeData>[]>(
    () =>
      flattenSteps(steps).map((step, index) => ({
        id: step.cid,
        type: "automation-node",
        position: step.position ??
          defaultPositions.get(step.cid) ?? { x: 80, y: 80 + index * 150 },
        data: {
          step,
          selected: selectedCid === step.cid,
          onDelete: onDeleteStep,
        },
      })),
    [defaultPositions, onDeleteStep, selectedCid, steps]
  )
  const edges = useMemo<Edge[]>(
    () =>
      executionConnections(steps).map((connection) => {
        const selected =
          connection.source === selectedCid || connection.target === selectedCid
        const color =
          connection.sourceHandle === "yes"
            ? "var(--primary)"
            : connection.sourceHandle === "no"
              ? "#f43f5e"
              : "var(--muted-foreground)"
        return {
          id: `${connection.source}:${connection.sourceHandle}:${connection.target}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          type: "smoothstep",
          animated: selected,
          label:
            connection.sourceHandle === "next"
              ? undefined
              : connection.sourceHandle,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 700 },
          labelBgStyle: { fill: "var(--card)" },
          labelBgPadding: [3, 2],
          labelBgBorderRadius: 4,
          style: { stroke: color, strokeWidth: selected ? 2.4 : 1.5 },
        }
      }),
    [selectedCid, steps]
  )
  const handleNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) =>
      onUpdateStepPosition(node.id, node.position.x, node.position.y),
    [onUpdateStepPosition]
  )

  return (
    <div className="bg-background h-full min-h-[520px] w-full overflow-hidden">
      <ReactFlow<Node<AutomationNodeData>>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 0.9 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_event, node) => onSelectStep(node.id)}
        onPaneClick={() => onSelectStep(null)}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.2}
          color="var(--border)"
        />
        <Controls className="!border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-muted [&_button_svg]:!fill-foreground !overflow-hidden !rounded-xl !shadow-lg" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            (node.data as AutomationNodeData).step.step_type === "condition"
              ? "#f59e0b"
              : "var(--primary)"
          }
          maskColor="color-mix(in oklch, var(--background) 72%, transparent)"
          className="!border-border !bg-card !rounded-xl !border !shadow-lg"
        />
      </ReactFlow>
    </div>
  )
}

interface AutomationNodeData extends Record<string, unknown> {
  step: BuilderStep
  selected: boolean
  onDelete: (cid: string) => void
}
const NODE_TYPES = { "automation-node": AutomationNodeCard }

function AutomationNodeCard({ data }: NodeProps<Node<AutomationNodeData>>) {
  const { step, selected, onDelete } = data
  const meta = STEP_META[step.step_type] ?? STEP_META.send_message
  const Icon = meta.icon
  const isCondition = step.step_type === "condition"
  return (
    <article
      className={cn(
        "group bg-card relative w-[238px] rounded-xl border px-3.5 py-3 text-left shadow-sm transition-[border-color,box-shadow]",
        selected
          ? "border-primary shadow-[0_0_0_1px_var(--primary),0_14px_30px_-16px_color-mix(in_srgb,var(--primary)_70%,transparent)]"
          : "border-border hover:border-primary/50 hover:shadow-md"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-border !bg-card !h-2.5 !w-2.5 !border-2"
      />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md",
            isCondition
              ? "bg-amber-500/15 text-amber-500"
              : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate text-xs font-semibold">
          {meta.label}
        </span>
        <button
          type="button"
          className="nodrag nopan text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded p-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(step.cid)
          }}
          aria-label={`Delete ${meta.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-muted-foreground mt-2 line-clamp-2 min-h-8 text-xs leading-4">
        {previewFor(step)}
      </p>
      {isCondition ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            style={{ top: "36%" }}
            className="!border-primary !bg-card !h-2.5 !w-2.5 !border-2"
          />
          <Handle
            id="no"
            type="source"
            position={Position.Right}
            style={{ top: "68%" }}
            className="!bg-card !h-2.5 !w-2.5 !border-2 !border-rose-500"
          />
          <Handle
            id="next"
            type="source"
            position={Position.Bottom}
            className="!border-muted-foreground !bg-card !h-2.5 !w-2.5 !border-2"
          />
        </>
      ) : (
        <Handle
          id="next"
          type="source"
          position={Position.Right}
          className="!border-primary !bg-card !h-2.5 !w-2.5 !border-2"
        />
      )}
    </article>
  )
}

const STEP_META: Record<string, { label: string; icon: typeof Zap }> = {
  send_message: { label: "Send message", icon: MessageSquare },
  send_buttons: { label: "Send buttons", icon: MousePointerClick },
  send_list: { label: "Send list", icon: List },
  send_template: { label: "Send template", icon: FileText },
  add_tag: { label: "Add tag", icon: Tag },
  remove_tag: { label: "Remove tag", icon: TagIcon },
  assign_conversation: { label: "Assign conversation", icon: UserCheck },
  update_contact_field: { label: "Update contact", icon: PencilLine },
  create_deal: { label: "Create deal", icon: Briefcase },
  wait: { label: "Delay", icon: Hourglass },
  condition: { label: "Condition", icon: GitBranch },
  send_webhook: { label: "Webhook", icon: Webhook },
  close_conversation: { label: "End workflow", icon: CircleSlash },
}
function flattenSteps(steps: BuilderStep[]): BuilderStep[] {
  return steps.flatMap((step) => [
    step,
    ...(step.branches
      ? [...flattenSteps(step.branches.yes), ...flattenSteps(step.branches.no)]
      : []),
  ])
}
function previewFor(step: BuilderStep): string {
  const config = step.step_config
  if (step.step_type === "send_message")
    return (config.text as string) || "Message content needed"
  if (step.step_type === "wait")
    return `${config.amount ?? "?"} ${config.unit ?? ""}`.trim()
  if (step.step_type === "condition")
    return `If ${config.subject ?? "a condition is met"}`
  if (step.step_type === "send_webhook")
    return (config.url as string) || "Endpoint needed"
  return "Configure this step"
}
