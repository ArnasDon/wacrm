import type { CustomFieldType } from '@/lib/contacts/custom-field-types';
import { validateCustomValue } from '@/lib/contacts/custom-field-types';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '../validate';
import {
  automationIntentSchema,
  type AutomationIntent,
  type AutomationIntentStep,
} from './intent';
import { generatedAutomationSchema, type GeneratedAutomation } from './schema';

export interface CompilationNamedResource {
  id: string;
  name: string;
}

export interface CompilationPipeline extends CompilationNamedResource {
  stages: CompilationNamedResource[];
}

export interface CompilationCustomField extends CompilationNamedResource {
  type: CustomFieldType;
  options: string[];
}

export interface CompilationTemplate extends CompilationNamedResource {
  language: string;
}

export interface CompilationInteractiveReply {
  id: string;
  label: string;
}

export interface AutomationCompilationResources {
  tags: CompilationNamedResource[];
  members: CompilationNamedResource[];
  customFields: CompilationCustomField[];
  pipelines: CompilationPipeline[];
  templates: CompilationTemplate[];
  interactiveReplies: CompilationInteractiveReply[];
}

export const COMPILATION_REASON_CODES = [
  'invalid_intent',
  'missing_reference',
  'resource_not_found',
  'resource_ambiguous',
  'invalid_custom_field_value',
  'invalid_parent',
  'invalid_automation',
] as const;

export type CompilationReasonCode = (typeof COMPILATION_REASON_CODES)[number];

export interface AutomationCompilationQuestion {
  kind: 'question';
  text: string;
  reasonCode: CompilationReasonCode;
  choices: string[];
}

export interface AutomationCompilationDraft {
  kind: 'draft';
  automation: GeneratedAutomation;
}

export type AutomationCompilationResult =
  AutomationCompilationDraft | AutomationCompilationQuestion;
export type CompileAutomationIntentResult = AutomationCompilationResult;

type CompiledStep = {
  step_type: string;
  step_config: Record<string, unknown>;
  branch: 'yes' | 'no' | null;
  parent_index: number | null;
};

type NamedCandidate<T> = {
  value: T;
  label: string;
  exact: string;
};

type ContactFieldCandidate =
  | { kind: 'built_in'; id: 'name' | 'email' | 'company'; name: string }
  | { kind: 'custom'; field: CompilationCustomField; name: string };

/**
 * Compile a model-facing, human-referenced intent into the exact runtime
 * automation format. Every uncertain decision is returned as a question;
 * this function never manufactures an id or emits an empty placeholder.
 */
export function compileAutomationIntent(
  input: AutomationIntent | unknown,
  resources: AutomationCompilationResources
): AutomationCompilationResult {
  const parsed = automationIntentSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const location = first?.path.length ? ` at ${first.path.join('.')}` : '';
    return question(
      `The automation request is incomplete or has an invalid shape${location}.`,
      'invalid_intent'
    );
  }

  const intent = parsed.data;
  const parentIssue = validateParentReferences(intent.steps);
  if (parentIssue) return parentIssue;

  const triggerResult = compileTrigger(intent, resources);
  if (isQuestion(triggerResult)) return triggerResult;

  const usedInteractiveIds = new Set<string>();
  const steps: CompiledStep[] = [];
  for (const [index, step] of intent.steps.entries()) {
    const result = compileStep(step, index, resources, usedInteractiveIds);
    if (isQuestion(result)) return result;
    steps.push(result);
  }

  const candidate: unknown = {
    name: intent.name,
    description: intent.description ?? '',
    trigger_type: intent.trigger_type,
    trigger_config: triggerResult,
    steps,
  };
  const generated = generatedAutomationSchema.safeParse(candidate);
  if (!generated.success) {
    const first = generated.error.issues[0];
    const location = first?.path.length ? ` at ${first.path.join('.')}` : '';
    return question(
      `The compiled automation is invalid${location}: ${first?.message ?? 'unknown error'}.`,
      'invalid_automation'
    );
  }

  const triggerIssues = validateTriggerForActivation(
    generated.data.trigger_type,
    generated.data.trigger_config
  );
  const stepIssues = validateStepsForActivation(
    toValidationTree(generated.data.steps)
  );
  const firstIssue = triggerIssues[0] ?? stepIssues[0];
  if (firstIssue) {
    return question(
      `The automation still needs a correction at ${firstIssue.path}: ${firstIssue.message}.`,
      'invalid_automation'
    );
  }

  return { kind: 'draft', automation: generated.data };
}

function compileTrigger(
  intent: AutomationIntent,
  resources: AutomationCompilationResources
): Record<string, unknown> | AutomationCompilationQuestion {
  switch (intent.trigger_type) {
    case 'new_message_received':
    case 'first_inbound_message':
    case 'new_contact_created':
    case 'conversation_assigned':
      return {};
    case 'keyword_match':
      return compact({
        keywords: intent.trigger_config.keywords,
        match_type: intent.trigger_config.match_type,
        case_sensitive: intent.trigger_config.case_sensitive,
      });
    case 'tag_added': {
      const tag = resolveNamedResource(
        intent.trigger_config.tag,
        resources.tags,
        'tag'
      );
      return isQuestion(tag) ? tag : { tag_id: tag.id };
    }
    case 'time_based':
      return compact({
        schedule: intent.trigger_config.schedule,
        timezone: intent.trigger_config.timezone,
      });
    case 'interactive_reply': {
      const replyIds: string[] = [];
      for (const label of intent.trigger_config.reply_labels) {
        const reply = resolveNamed(
          label,
          resources.interactiveReplies.map((item) => ({
            value: item,
            label: item.label,
            exact: item.label,
          })),
          'reply label'
        );
        if (isQuestion(reply)) return reply;
        if (!replyIds.includes(reply.id)) replyIds.push(reply.id);
      }
      return { reply_ids: replyIds };
    }
    case 'deal_stage_changed': {
      if (intent.trigger_config.pipeline === null) return {};
      const pipeline = resolveNamedResource(
        intent.trigger_config.pipeline,
        resources.pipelines,
        'pipeline'
      );
      return isQuestion(pipeline) ? pipeline : { pipeline_id: pipeline.id };
    }
  }
}

function compileStep(
  step: AutomationIntentStep,
  stepIndex: number,
  resources: AutomationCompilationResources,
  usedInteractiveIds: Set<string>
): CompiledStep | AutomationCompilationQuestion {
  const wrap = (stepConfig: Record<string, unknown>): CompiledStep => ({
    step_type: step.step_type,
    step_config: stepConfig,
    branch: step.branch,
    parent_index: step.parent_index,
  });

  switch (step.step_type) {
    case 'send_message':
      return wrap({ text: step.step_config.text });
    case 'send_buttons':
      return wrap(
        compact({
          kind: 'buttons',
          body: step.step_config.body,
          header: step.step_config.header,
          footer: step.step_config.footer,
          buttons: step.step_config.buttons.map((button, buttonIndex) => ({
            id: stableInteractiveId(
              'button',
              `${stepIndex}:${buttonIndex}:${button.title}`,
              button.title,
              usedInteractiveIds
            ),
            title: button.title,
          })),
        })
      );
    case 'send_list':
      return wrap(
        compact({
          kind: 'list',
          body: step.step_config.body,
          header: step.step_config.header,
          footer: step.step_config.footer,
          button_label: step.step_config.button_label,
          sections: step.step_config.sections.map((section, sectionIndex) =>
            compact({
              title: section.title,
              rows: section.rows.map((row, rowIndex) =>
                compact({
                  id: stableInteractiveId(
                    'row',
                    `${stepIndex}:${sectionIndex}:${rowIndex}:${row.title}`,
                    row.title,
                    usedInteractiveIds
                  ),
                  title: row.title,
                  description: row.description,
                })
              ),
            })
          ),
        })
      );
    case 'send_template': {
      const template = resolveTemplate(
        step.step_config.template,
        step.step_config.language,
        resources.templates
      );
      if (isQuestion(template)) return template;
      return wrap(
        compact({
          template_name: template.name,
          language: template.language,
          variables: step.step_config.variables,
        })
      );
    }
    case 'add_tag':
    case 'remove_tag': {
      const tag = resolveNamedResource(
        step.step_config.tag,
        resources.tags,
        'tag'
      );
      return isQuestion(tag) ? tag : wrap({ tag_id: tag.id });
    }
    case 'assign_conversation': {
      if (step.step_config.mode === 'round_robin') {
        return wrap({ mode: 'round_robin' });
      }
      const agent = resolveNamedResource(
        step.step_config.agent,
        resources.members,
        'agent'
      );
      return isQuestion(agent)
        ? agent
        : wrap({ mode: 'specific', agent_id: agent.id });
    }
    case 'update_contact_field': {
      const field = resolveContactField(
        step.step_config.field,
        resources.customFields
      );
      if (isQuestion(field)) return field;
      if (field.kind === 'built_in') {
        return wrap({ field: field.id, value: step.step_config.value });
      }
      const value = compileCustomFieldValue(
        field.field,
        step.step_config.value
      );
      if (isQuestion(value)) return value;
      return wrap({ field: `custom:${field.field.id}`, value });
    }
    case 'create_deal':
    case 'move_deal_stage': {
      const pipelineAndStage = resolvePipelineAndStage(
        step.step_config.pipeline,
        step.step_config.stage,
        resources.pipelines
      );
      if (isQuestion(pipelineAndStage)) return pipelineAndStage;
      const base = {
        pipeline_id: pipelineAndStage.pipeline.id,
        stage_id: pipelineAndStage.stage.id,
      };
      if (step.step_type === 'move_deal_stage') return wrap(base);
      return wrap(
        compact({
          ...base,
          title: step.step_config.title,
          value: step.step_config.value,
        })
      );
    }
    case 'wait':
      return wrap({
        amount: step.step_config.amount,
        unit: step.step_config.unit,
      });
    case 'condition': {
      const config = step.step_config;
      switch (config.subject) {
        case 'contact_field': {
          const field = resolveContactField(
            config.field,
            resources.customFields
          );
          if (isQuestion(field)) return field;
          if (field.kind === 'built_in') {
            return wrap({
              subject: 'contact_field',
              operand: field.id,
              value: config.value,
            });
          }
          const value = compileCustomFieldValue(field.field, config.value);
          return isQuestion(value)
            ? value
            : wrap({
                subject: 'contact_field',
                operand: `custom:${field.field.id}`,
                value,
              });
        }
        case 'tag_presence': {
          const tag = resolveNamedResource(config.tag, resources.tags, 'tag');
          return isQuestion(tag)
            ? tag
            : wrap({ subject: 'tag_presence', operand: tag.id });
        }
        case 'message_content':
          return wrap({ subject: 'message_content', value: config.value });
        case 'time_of_day':
          return wrap({ subject: 'time_of_day', operand: config.range });
        case 'deal_stage': {
          const resolved = resolvePipelineAndStage(
            config.pipeline,
            config.stage,
            resources.pipelines
          );
          return isQuestion(resolved)
            ? resolved
            : wrap({ subject: 'deal_stage', operand: resolved.stage.id });
        }
      }
    }
    case 'send_webhook':
      return wrap(
        compact({
          url: step.step_config.url,
          headers: step.step_config.headers,
          body_template: step.step_config.body_template,
        })
      );
    case 'close_conversation':
      return wrap({});
  }
}

function validateParentReferences(
  steps: AutomationIntentStep[]
): AutomationCompilationQuestion | null {
  for (const [index, step] of steps.entries()) {
    if (step.parent_index === null) {
      if (step.branch !== null) {
        return question(
          `Step ${index + 1} has a branch but no parent condition.`,
          'invalid_parent',
          ['yes', 'no']
        );
      }
      continue;
    }

    const parent = steps[step.parent_index];
    if (
      step.parent_index >= index ||
      !parent ||
      parent.step_type !== 'condition'
    ) {
      return question(
        `Step ${index + 1} must reference an earlier condition as its parent.`,
        'invalid_parent'
      );
    }
    if (step.branch === null) {
      return question(
        `Step ${index + 1} needs a yes or no branch for its parent condition.`,
        'invalid_parent',
        ['yes', 'no']
      );
    }
  }
  return null;
}

const BUILT_IN_CONTACT_FIELDS = [
  { kind: 'built_in', id: 'name', name: 'name' },
  { kind: 'built_in', id: 'email', name: 'email' },
  { kind: 'built_in', id: 'company', name: 'company' },
] as const satisfies ContactFieldCandidate[];

function resolveContactField(
  reference: string,
  customFields: CompilationCustomField[]
): ContactFieldCandidate | AutomationCompilationQuestion {
  const candidates: NamedCandidate<ContactFieldCandidate>[] = [
    ...BUILT_IN_CONTACT_FIELDS.map((item) => ({
      value: item,
      label: item.name,
      exact: item.name,
    })),
    ...customFields.map((field) => ({
      value: { kind: 'custom' as const, field, name: field.name },
      label: field.name,
      exact: field.name,
    })),
  ];
  return resolveNamed<ContactFieldCandidate>(
    reference,
    candidates,
    'contact field'
  );
}

function resolvePipelineAndStage(
  pipelineReference: string,
  stageReference: string,
  pipelines: CompilationPipeline[]
):
  | { pipeline: CompilationPipeline; stage: CompilationNamedResource }
  | AutomationCompilationQuestion {
  const pipeline = resolveNamedResource(
    pipelineReference,
    pipelines,
    'pipeline'
  );
  if (isQuestion(pipeline)) return pipeline;
  const stage = resolveNamedResource(
    stageReference,
    pipeline.stages,
    `stage in pipeline "${pipeline.name}"`
  );
  return isQuestion(stage) ? stage : { pipeline, stage };
}

function resolveTemplate(
  nameReference: string,
  languageReference: string | null,
  templates: CompilationTemplate[]
): CompilationTemplate | AutomationCompilationQuestion {
  const nameMatches = exactThenNormalizedMatches(
    nameReference,
    templates,
    (template) => template.name
  );
  if (nameMatches.length === 0) {
    return resourceQuestion(
      'resource_not_found',
      'template',
      nameReference,
      templates.map(templateLabel)
    );
  }
  if (languageReference === null) {
    if (nameMatches.length === 1) return nameMatches[0];
    return resourceQuestion(
      'missing_reference',
      'template language',
      null,
      nameMatches.map((template) => template.language)
    );
  }

  const languageMatches = exactThenNormalizedMatches(
    languageReference,
    nameMatches,
    (template) => template.language
  );
  if (languageMatches.length === 1) return languageMatches[0];
  if (languageMatches.length === 0) {
    return resourceQuestion(
      'resource_not_found',
      `language for template "${nameReference}"`,
      languageReference,
      nameMatches.map((template) => template.language)
    );
  }
  return resourceQuestion(
    'resource_ambiguous',
    'template',
    `${nameReference} (${languageReference})`,
    languageMatches.map(templateLabel)
  );
}

function templateLabel(template: CompilationTemplate): string {
  return `${template.name} (${template.language})`;
}

function compileCustomFieldValue(
  field: CompilationCustomField,
  value: string
): string | AutomationCompilationQuestion {
  if (hasDynamicInterpolation(value)) return value;

  if (field.type === 'select') {
    const optionMatches = exactThenNormalizedMatches(
      value,
      field.options,
      (option) => option
    );
    if (optionMatches.length === 1) return optionMatches[0];
    const reasonCode =
      optionMatches.length === 0
        ? 'invalid_custom_field_value'
        : 'resource_ambiguous';
    return question(
      optionMatches.length === 0
        ? `"${value}" is not a configured option for custom field "${field.name}".`
        : `"${value}" matches more than one option for custom field "${field.name}".`,
      reasonCode,
      optionMatches.length === 0 ? field.options : optionMatches
    );
  }

  if (
    field.type === 'checkbox' &&
    value.trim() !== '' &&
    !['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(
      value.trim().toLowerCase()
    )
  ) {
    return question(
      `"${value}" is not a valid checkbox value for custom field "${field.name}".`,
      'invalid_custom_field_value',
      ['true', 'false']
    );
  }

  const validationError = validateCustomValue(field.type, value, {
    options: field.options,
  });
  return validationError
    ? question(
        `The value for custom field "${field.name}" is invalid: ${validationError}`,
        'invalid_custom_field_value'
      )
    : value;
}

function hasDynamicInterpolation(value: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(value);
}

function resolveNamedResource<T extends CompilationNamedResource>(
  reference: string | null,
  resources: T[],
  resourceKind: string
): T | AutomationCompilationQuestion {
  return resolveNamed(
    reference,
    resources.map((resource) => ({
      value: resource,
      label: resource.name,
      exact: resource.name,
    })),
    resourceKind
  );
}

function resolveNamed<T>(
  reference: string | null,
  candidates: NamedCandidate<T>[],
  resourceKind: string
): T | AutomationCompilationQuestion {
  if (reference === null || reference.trim() === '') {
    return resourceQuestion(
      'missing_reference',
      resourceKind,
      null,
      candidates.map((candidate) => candidate.label)
    );
  }

  const matches = exactThenNormalizedMatches(
    reference,
    candidates,
    (candidate) => candidate.exact
  );
  if (matches.length === 1) return matches[0].value;
  if (matches.length === 0) {
    return resourceQuestion(
      'resource_not_found',
      resourceKind,
      reference,
      candidates.map((candidate) => candidate.label)
    );
  }
  return resourceQuestion(
    'resource_ambiguous',
    resourceKind,
    reference,
    matches.map((candidate) => candidate.label)
  );
}

function exactThenNormalizedMatches<T>(
  reference: string,
  candidates: T[],
  getReference: (candidate: T) => string
): T[] {
  const trimmed = reference.trim();
  const exact = candidates.filter(
    (candidate) => getReference(candidate).trim() === trimmed
  );
  if (exact.length > 0) return exact;

  const normalized = normalizeHumanReference(trimmed);
  return candidates.filter(
    (candidate) =>
      normalizeHumanReference(getReference(candidate)) === normalized
  );
}

export function normalizeHumanReference(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, '');
}

function stableInteractiveId(
  kind: 'button' | 'row',
  key: string,
  label: string,
  usedIds: Set<string>
): string {
  const slug =
    label
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || kind;
  const base = `${kind}_${slug}_${fnv1a(key)}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== null && item !== undefined
    )
  );
}

function toValidationTree(
  steps: GeneratedAutomation['steps']
): ValidationStep[] {
  const nodes: ValidationStep[] = steps.map((step) => ({
    step_type: step.step_type,
    step_config: step.step_config as Record<string, unknown>,
    ...(step.step_type === 'condition'
      ? { branches: { yes: [], no: [] } }
      : {}),
  }));
  const roots: ValidationStep[] = [];

  steps.forEach((step, index) => {
    const node = nodes[index];
    if (step.parent_index === null) {
      roots.push(node);
      return;
    }
    const parent = nodes[step.parent_index];
    const branch = step.branch;
    if (parent?.branches && branch) parent.branches[branch].push(node);
  });
  return roots;
}

interface ValidationStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes: ValidationStep[]; no: ValidationStep[] };
}

function resourceQuestion(
  reasonCode: 'missing_reference' | 'resource_not_found' | 'resource_ambiguous',
  resourceKind: string,
  reference: string | null,
  choices: string[]
): AutomationCompilationQuestion {
  const text =
    reasonCode === 'missing_reference'
      ? `Which ${resourceKind} should be used?`
      : reasonCode === 'resource_not_found'
        ? `No ${resourceKind} matches "${reference}". Which one should be used?`
        : `More than one ${resourceKind} matches "${reference}". Which one should be used?`;
  return question(text, reasonCode, choices);
}

function question(
  text: string,
  reasonCode: CompilationReasonCode,
  choices: string[] = []
): AutomationCompilationQuestion {
  return {
    kind: 'question',
    text,
    reasonCode,
    choices: unique(choices),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isQuestion<T>(
  value: T | AutomationCompilationQuestion
): value is AutomationCompilationQuestion {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'question'
  );
}

export type { AutomationIntent, GeneratedAutomation };
