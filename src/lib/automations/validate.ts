import type {
  AutomationStepType,
  AutomationTriggerType,
} from "@/types";
import { validateFlowForActivation } from "@/lib/flows/validate";
import {
  automationStepNodeType,
  automationToFlowGraph,
  automationTriggerNodeType,
  type LegacyAutomationGraphStep,
} from "./to-flow-graph";

export interface ValidationIssue {
  path: string;
  message: string;
}

interface StepLike {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: StepLike[]; no?: StepLike[] };
}

interface FlattenedStep {
  step: StepLike;
  path: string;
  parentIndex: number | null;
  branch: "yes" | "no" | null;
}

const FIELD_MESSAGES: Partial<
  Record<AutomationStepType, Record<string, string>>
> = {
  send_message: { text: "message text is required" },
  send_template: { template_name: "template name is required" },
  add_tag: { tag_id: "tag is required" },
  remove_tag: { tag_id: "tag is required" },
  assign_conversation: {
    agent_id: 'agent is required when mode is "specific"',
  },
  update_contact_field: {
    field: "field name is required",
    value: "field value is required",
  },
  create_deal: {
    pipeline_id: "pipeline is required",
    stage_id: "stage is required",
    title: "title is required",
  },
  move_deal_stage: {
    pipeline_id: "pipeline is required",
    stage_id: "stage is required",
  },
  wait: {
    amount: "wait amount must be greater than 0",
    unit: "wait unit must be minutes, hours, or days",
  },
  condition: {
    subject: "condition subject is required",
    operand: "condition operand is required",
    value: "message content value is required",
  },
};

export function validateStepsForActivation(
  steps: StepLike[],
): ValidationIssue[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [
      {
        path: "steps",
        message: "active automations need at least one step",
      },
    ];
  }

  const flattened = flattenSteps(steps);
  const issues: ValidationIssue[] = [];
  const originalToCanonical = new Map<number, number>();
  const canonicalRecords: FlattenedStep[] = [];

  flattened.forEach((record, originalIndex) => {
    if (!automationStepNodeType(record.step.step_type)) {
      issues.push({
        path: record.path,
        message: `unknown step type: ${record.step.step_type}`,
      });
      return;
    }
    originalToCanonical.set(originalIndex, canonicalRecords.length);
    canonicalRecords.push(record);
  });

  if (canonicalRecords.length === 0) return issues;

  const canonicalSteps = canonicalRecords.map<LegacyAutomationGraphStep>(
    (record) => ({
      step_type: record.step.step_type as AutomationStepType,
      step_config: record.step.step_config,
      parent_index:
        record.parentIndex === null
          ? null
          : (originalToCanonical.get(record.parentIndex) ?? null),
      branch: record.branch,
    }),
  );
  const graph = automationToFlowGraph({
    trigger_type: "new_message_received",
    trigger_config: {},
    steps: canonicalSteps,
  });
  const graphIssues = validateFlowForActivation(
    {
      name: "Automation compatibility graph",
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: graph.entry_node_key,
    },
    graph.nodes,
    { consumer: "automation" },
  );
  const recordByNodeKey = new Map(
    graph.nodes.flatMap((node) =>
      node.source_index === undefined
        ? []
        : [[node.node_key, canonicalRecords[node.source_index]!] as const],
    ),
  );

  for (const issue of graphIssues) {
    if (issue.scope !== "node" || !issue.node_key) continue;
    const record = recordByNodeKey.get(issue.node_key);
    if (!record) continue;
    const field = issue.field ?? "";
    const path = compatibilityPath(record, field);
    const message = compatibilityMessage(record, field, issue.message);
    if (!issues.some((existing) => existing.path === path && existing.message === message)) {
      issues.push({ path, message });
    }
  }
  return issues;
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  if (!automationTriggerNodeType(triggerType)) return [];

  const graph = automationToFlowGraph({
    trigger_type: triggerType as AutomationTriggerType,
    trigger_config: (triggerConfig ?? {}) as Record<string, unknown>,
    steps: [],
  });
  const issues = validateFlowForActivation(
    {
      name: "Automation compatibility graph",
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: graph.entry_node_key,
    },
    graph.nodes,
    { consumer: "automation" },
  );

  return issues
    .filter(
      (issue) =>
        issue.scope === "node" && issue.node_key === graph.entry_node_key,
    )
    .map((issue) => {
      const field = issue.field ?? "";
      const rootField = field.split(".")[0] ?? field;
      return {
        path: rootField ? `trigger.${rootField}` : "trigger",
        message: triggerCompatibilityMessage(
          triggerType,
          rootField,
          triggerConfig,
          issue.message,
        ),
      };
    })
    .filter(
      (issue, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.path === issue.path && candidate.message === issue.message,
        ) === index,
    );
}

function flattenSteps(
  steps: StepLike[],
  prefix = "",
  parentIndex: number | null = null,
  branch: "yes" | "no" | null = null,
  output: FlattenedStep[] = [],
): FlattenedStep[] {
  steps.forEach((step, index) => {
    const path = `${prefix}steps[${index}]`;
    const ownIndex = output.length;
    output.push({ step, path, parentIndex, branch });
    if (step.step_type !== "condition") return;
    if (step.branches?.yes) {
      flattenSteps(step.branches.yes, `${path}.yes.`, ownIndex, "yes", output);
    }
    if (step.branches?.no) {
      flattenSteps(step.branches.no, `${path}.no.`, ownIndex, "no", output);
    }
  });
  return output;
}

function compatibilityPath(record: FlattenedStep, field: string): string {
  if (
    record.step.step_type === "send_buttons" ||
    record.step.step_type === "send_list"
  ) {
    return `${record.path}.interactive`;
  }
  return field ? `${record.path}.${field}` : record.path;
}

function compatibilityMessage(
  record: FlattenedStep,
  field: string,
  canonicalMessage: string,
): string {
  if (record.step.step_type === "send_webhook" && field === "url") {
    const url = record.step.step_config.url;
    if (typeof url !== "string" || !url.trim()) return "webhook URL is required";
    try {
      const protocol = new URL(url).protocol;
      if (protocol !== "http:" && protocol !== "https:") {
        return "webhook URL must use http or https";
      }
    } catch {
      return "webhook URL is not a valid URL";
    }
  }
  return (
    FIELD_MESSAGES[record.step.step_type as AutomationStepType]?.[field] ??
    canonicalMessage
  );
}

function triggerCompatibilityMessage(
  triggerType: string,
  field: string,
  triggerConfig: unknown,
  canonicalMessage: string,
): string {
  const config = (triggerConfig ?? {}) as Record<string, unknown>;
  if (triggerType === "keyword_match") {
    if (field === "keywords") {
      return Array.isArray(config.keywords) && config.keywords.length > 0
        ? "keywords cannot be empty strings"
        : "at least one keyword is required";
    }
    if (field === "match_type") {
      return 'match type must be "exact" or "contains"';
    }
  }
  if (triggerType === "time_based" && field === "schedule") {
    return "schedule is required";
  }
  if (triggerType === "tag_added" && field === "tag_id") {
    return "tag is required";
  }
  if (triggerType === "interactive_reply" && field === "reply_ids") {
    return Array.isArray(config.reply_ids) && config.reply_ids.length > 0
      ? "reply ids cannot be empty strings"
      : "at least one reply id is required";
  }
  return canonicalMessage;
}
