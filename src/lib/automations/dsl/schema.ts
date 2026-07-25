import { z } from 'zod';

export const AUTOMATION_TRIGGER_TYPES = [
  'new_message_received',
  'first_inbound_message',
  'keyword_match',
  'new_contact_created',
  'conversation_assigned',
  'tag_added',
  'time_based',
  'interactive_reply',
  'deal_stage_changed',
] as const;

export const AUTOMATION_STEP_TYPES = [
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
  'add_tag',
  'remove_tag',
  'assign_conversation',
  'update_contact_field',
  'create_deal',
  'move_deal_stage',
  'wait',
  'condition',
  'send_webhook',
  'close_conversation',
] as const;

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
  message: 'must not be empty',
});
const trimmedNonEmptyString = z.string().trim().min(1);
const emptyConfigSchema = z.strictObject({});
const stringMapSchema = z.record(trimmedNonEmptyString, z.string());
const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'must use http or https');

const interactiveButtonSchema = z.strictObject({
  id: trimmedNonEmptyString.max(256),
  title: nonEmptyString.max(20),
});

const interactiveListRowSchema = z.strictObject({
  id: trimmedNonEmptyString.max(256),
  title: nonEmptyString.max(24),
  description: nonEmptyString.max(72).optional(),
});

const interactiveListSectionSchema = z.strictObject({
  title: nonEmptyString.optional(),
  rows: z.array(interactiveListRowSchema).min(1).max(10),
});

export const sendButtonsConfigSchema = z
  .strictObject({
    kind: z.literal('buttons'),
    body: nonEmptyString.max(1024),
    header: nonEmptyString.max(60).optional(),
    footer: nonEmptyString.max(60).optional(),
    buttons: z.array(interactiveButtonSchema).min(1).max(3),
  })
  .superRefine((config, context) => {
    addDuplicateIdIssue(
      config.buttons.map((button) => button.id),
      ['buttons'],
      context
    );
  });

export const sendListConfigSchema = z
  .strictObject({
    kind: z.literal('list'),
    body: nonEmptyString.max(1024),
    header: nonEmptyString.max(60).optional(),
    footer: nonEmptyString.max(60).optional(),
    button_label: nonEmptyString.max(20),
    sections: z.array(interactiveListSectionSchema).min(1).max(10),
  })
  .superRefine((config, context) => {
    const rows = config.sections.flatMap((section) => section.rows);
    if (rows.length > 10) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'a list allows at most 10 rows in total',
      });
    }
    addDuplicateIdIssue(
      rows.map((row) => row.id),
      ['sections'],
      context
    );
  });

function addDuplicateIdIssue(
  ids: string[],
  path: PropertyKey[],
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  if (ids.some((id) => seen.size === seen.add(id).size)) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'interactive ids must be unique',
    });
  }
}

export const keywordMatchTriggerConfigSchema = z.strictObject({
  keywords: z.array(trimmedNonEmptyString).min(1),
  match_type: z.enum(['exact', 'contains']),
  case_sensitive: z.boolean().optional(),
});

export const timeBasedTriggerConfigSchema = z.strictObject({
  schedule: trimmedNonEmptyString,
  timezone: trimmedNonEmptyString.optional(),
});

export const tagAddedTriggerConfigSchema = z.strictObject({
  tag_id: trimmedNonEmptyString,
});

export const interactiveReplyTriggerConfigSchema = z
  .strictObject({
    reply_ids: z.array(trimmedNonEmptyString).min(1),
  })
  .superRefine((config, context) => {
    addDuplicateIdIssue(config.reply_ids, ['reply_ids'], context);
  });

export const dealStageChangedTriggerConfigSchema = z.strictObject({
  pipeline_id: trimmedNonEmptyString.optional(),
});

const generatedTriggerSchemas = [
  generatedTrigger('new_message_received', emptyConfigSchema),
  generatedTrigger('first_inbound_message', emptyConfigSchema),
  generatedTrigger('keyword_match', keywordMatchTriggerConfigSchema),
  generatedTrigger('new_contact_created', emptyConfigSchema),
  generatedTrigger('conversation_assigned', emptyConfigSchema),
  generatedTrigger('tag_added', tagAddedTriggerConfigSchema),
  generatedTrigger('time_based', timeBasedTriggerConfigSchema),
  generatedTrigger('interactive_reply', interactiveReplyTriggerConfigSchema),
  generatedTrigger('deal_stage_changed', dealStageChangedTriggerConfigSchema),
] as const;

function generatedTrigger<
  const Type extends (typeof AUTOMATION_TRIGGER_TYPES)[number],
  Config extends z.ZodType,
>(triggerType: Type, triggerConfig: Config) {
  return z.strictObject({
    trigger_type: z.literal(triggerType),
    trigger_config: triggerConfig,
  });
}

export const generatedAutomationTriggerSchema = z.discriminatedUnion(
  'trigger_type',
  generatedTriggerSchemas
);

export const sendMessageStepConfigSchema = z.strictObject({
  text: nonEmptyString,
});

export const sendTemplateStepConfigSchema = z.strictObject({
  template_name: trimmedNonEmptyString,
  language: trimmedNonEmptyString.optional(),
  variables: stringMapSchema.optional(),
});

export const tagStepConfigSchema = z.strictObject({
  tag_id: trimmedNonEmptyString,
});

export const assignConversationStepConfigSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('specific'),
    agent_id: trimmedNonEmptyString,
  }),
  z.strictObject({
    mode: z.literal('round_robin'),
  }),
]);

export const updateContactFieldStepConfigSchema = z.strictObject({
  field: trimmedNonEmptyString,
  value: z.string(),
});

export const createDealStepConfigSchema = z.strictObject({
  pipeline_id: trimmedNonEmptyString,
  stage_id: trimmedNonEmptyString,
  title: nonEmptyString,
  value: z.number().finite().optional(),
});

export const moveDealStageStepConfigSchema = z.strictObject({
  pipeline_id: trimmedNonEmptyString,
  stage_id: trimmedNonEmptyString,
});

export const waitStepConfigSchema = z.strictObject({
  amount: z.number().finite().positive(),
  unit: z.enum(['minutes', 'hours', 'days']),
});

const hhmm = '(?:[01]\\d|2[0-3]):[0-5]\\d';
const timeRangeSchema = z.string().regex(new RegExp(`^${hhmm}-${hhmm}$`));

export const conditionStepConfigSchema = z.discriminatedUnion('subject', [
  z.strictObject({
    subject: z.literal('contact_field'),
    operand: trimmedNonEmptyString,
    value: z.string(),
  }),
  z.strictObject({
    subject: z.literal('tag_presence'),
    operand: trimmedNonEmptyString,
  }),
  z.strictObject({
    subject: z.literal('message_content'),
    value: nonEmptyString,
  }),
  z.strictObject({
    subject: z.literal('time_of_day'),
    operand: timeRangeSchema,
  }),
  z.strictObject({
    subject: z.literal('deal_stage'),
    operand: trimmedNonEmptyString,
  }),
]);

export const sendWebhookStepConfigSchema = z.strictObject({
  url: httpUrlSchema,
  headers: stringMapSchema.optional(),
  body_template: z.string().optional(),
});

const branchSchema = z.enum(['yes', 'no']).nullable();
const parentIndexSchema = z.number().int().nonnegative().nullable();

function generatedStep<
  const Type extends (typeof AUTOMATION_STEP_TYPES)[number],
  Config extends z.ZodType,
>(stepType: Type, stepConfig: Config) {
  return z.strictObject({
    step_type: z.literal(stepType),
    step_config: stepConfig,
    branch: branchSchema,
    parent_index: parentIndexSchema,
  });
}

const generatedStepSchemas = [
  generatedStep('send_message', sendMessageStepConfigSchema),
  generatedStep('send_buttons', sendButtonsConfigSchema),
  generatedStep('send_list', sendListConfigSchema),
  generatedStep('send_template', sendTemplateStepConfigSchema),
  generatedStep('add_tag', tagStepConfigSchema),
  generatedStep('remove_tag', tagStepConfigSchema),
  generatedStep('assign_conversation', assignConversationStepConfigSchema),
  generatedStep('update_contact_field', updateContactFieldStepConfigSchema),
  generatedStep('create_deal', createDealStepConfigSchema),
  generatedStep('move_deal_stage', moveDealStageStepConfigSchema),
  generatedStep('wait', waitStepConfigSchema),
  generatedStep('condition', conditionStepConfigSchema),
  generatedStep('send_webhook', sendWebhookStepConfigSchema),
  generatedStep('close_conversation', emptyConfigSchema),
] as const;

export const generatedAutomationStepSchema = z.discriminatedUnion(
  'step_type',
  generatedStepSchemas
);

const generatedAutomationStepsSchema = z
  .array(generatedAutomationStepSchema)
  .min(1)
  .superRefine((steps, context) => {
    const interactiveIds = new Set<string>();

    steps.forEach((step, index) => {
      if (step.parent_index === null) {
        if (step.branch !== null) {
          context.addIssue({
            code: 'custom',
            path: [index, 'branch'],
            message: 'a branch requires an earlier condition parent',
          });
        }
      } else {
        const parent = steps[step.parent_index];
        if (
          step.parent_index >= index ||
          !parent ||
          parent.step_type !== 'condition'
        ) {
          context.addIssue({
            code: 'custom',
            path: [index, 'parent_index'],
            message: 'parent_index must reference an earlier condition',
          });
        }
        if (step.branch === null) {
          context.addIssue({
            code: 'custom',
            path: [index, 'branch'],
            message: 'a condition child requires a yes or no branch',
          });
        }
      }

      const ids =
        step.step_type === 'send_buttons'
          ? step.step_config.buttons.map((button) => button.id)
          : step.step_type === 'send_list'
            ? step.step_config.sections.flatMap((section) =>
                section.rows.map((row) => row.id)
              )
            : [];
      for (const id of ids) {
        if (interactiveIds.has(id)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'step_config'],
            message: 'interactive ids must be unique across the automation',
          });
        }
        interactiveIds.add(id);
      }
    });
  });

const generatedAutomationBase = {
  name: trimmedNonEmptyString.max(120),
  description: z.string().max(500),
  steps: generatedAutomationStepsSchema,
};

function generatedAutomation<
  const Type extends (typeof AUTOMATION_TRIGGER_TYPES)[number],
  Config extends z.ZodType,
>(triggerType: Type, triggerConfig: Config) {
  return z.strictObject({
    ...generatedAutomationBase,
    trigger_type: z.literal(triggerType),
    trigger_config: triggerConfig,
  });
}

const generatedAutomationSchemas = [
  generatedAutomation('new_message_received', emptyConfigSchema),
  generatedAutomation('first_inbound_message', emptyConfigSchema),
  generatedAutomation('keyword_match', keywordMatchTriggerConfigSchema),
  generatedAutomation('new_contact_created', emptyConfigSchema),
  generatedAutomation('conversation_assigned', emptyConfigSchema),
  generatedAutomation('tag_added', tagAddedTriggerConfigSchema),
  generatedAutomation('time_based', timeBasedTriggerConfigSchema),
  generatedAutomation('interactive_reply', interactiveReplyTriggerConfigSchema),
  generatedAutomation(
    'deal_stage_changed',
    dealStageChangedTriggerConfigSchema
  ),
] as const;

export const generatedAutomationSchema = z.discriminatedUnion(
  'trigger_type',
  generatedAutomationSchemas
);

export const compiledAutomationSchema = generatedAutomationSchema;

export type GeneratedAutomation = z.infer<typeof generatedAutomationSchema>;
export type GeneratedAutomationStep = z.infer<
  typeof generatedAutomationStepSchema
>;
export type GeneratedStep = GeneratedAutomationStep;
export type GeneratedAutomationTrigger = z.infer<
  typeof generatedAutomationTriggerSchema
>;
export type AutomationTriggerType = GeneratedAutomation['trigger_type'];
export type AutomationStepType = GeneratedAutomationStep['step_type'];
