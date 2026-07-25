import { z } from 'zod';
import { AUTOMATION_STEP_TYPES, AUTOMATION_TRIGGER_TYPES } from './schema';

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
  message: 'must not be empty',
});
const trimmedNonEmptyString = z.string().trim().min(1);
const nullableNonEmptyString = trimmedNonEmptyString.nullable();
const uuidReferencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const humanReferenceSchema = trimmedNonEmptyString.refine(
  (value) => !uuidReferencePattern.test(value),
  'must use a human-readable name instead of a UUID'
);
const nullableHumanReferenceSchema = humanReferenceSchema.nullable();
const requiredNullableStringMap = z
  .record(trimmedNonEmptyString, z.string())
  .nullable();
const emptyConfigSchema = z.strictObject({});
const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'must use http or https');

function intentTrigger<
  const Type extends (typeof AUTOMATION_TRIGGER_TYPES)[number],
  Config extends z.ZodType,
>(triggerType: Type, triggerConfig: Config) {
  return z.strictObject({
    trigger_type: z.literal(triggerType),
    trigger_config: triggerConfig,
  });
}

const intentTriggerSchemas = [
  intentTrigger('new_message_received', emptyConfigSchema),
  intentTrigger('first_inbound_message', emptyConfigSchema),
  intentTrigger(
    'keyword_match',
    z.strictObject({
      keywords: z.array(trimmedNonEmptyString).min(1),
      match_type: z.enum(['exact', 'contains']),
      case_sensitive: z.boolean().nullable(),
    })
  ),
  intentTrigger('new_contact_created', emptyConfigSchema),
  intentTrigger('conversation_assigned', emptyConfigSchema),
  intentTrigger(
    'tag_added',
    z.strictObject({
      tag: humanReferenceSchema,
    })
  ),
  intentTrigger(
    'time_based',
    z.strictObject({
      schedule: trimmedNonEmptyString,
      timezone: nullableNonEmptyString,
    })
  ),
  intentTrigger(
    'interactive_reply',
    z.strictObject({
      reply_labels: z.array(humanReferenceSchema).min(1),
    })
  ),
  intentTrigger(
    'deal_stage_changed',
    z.strictObject({
      pipeline: nullableHumanReferenceSchema,
    })
  ),
] as const;

export const automationIntentTriggerSchema = z.discriminatedUnion(
  'trigger_type',
  intentTriggerSchemas
);

const intentButtonSchema = z.strictObject({
  title: nonEmptyString.max(20),
});

const intentListRowSchema = z.strictObject({
  title: nonEmptyString.max(24),
  description: nonEmptyString.max(72).nullable(),
});

const intentListSectionSchema = z.strictObject({
  title: nonEmptyString.nullable(),
  rows: z.array(intentListRowSchema).min(1).max(10),
});

const intentSendListConfigSchema = z
  .strictObject({
    kind: z.literal('list'),
    body: nonEmptyString.max(1024),
    header: nonEmptyString.max(60).nullable(),
    footer: nonEmptyString.max(60).nullable(),
    button_label: nonEmptyString.max(20),
    sections: z.array(intentListSectionSchema).min(1).max(10),
  })
  .superRefine((config, context) => {
    if (
      config.sections.reduce(
        (total, section) => total + section.rows.length,
        0
      ) > 10
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'a list allows at most 10 rows in total',
      });
    }
  });

const hhmm = '(?:[01]\\d|2[0-3]):[0-5]\\d';
const timeRangeSchema = z.string().regex(new RegExp(`^${hhmm}-${hhmm}$`));

export const automationIntentConditionConfigSchema = z.discriminatedUnion(
  'subject',
  [
    z.strictObject({
      subject: z.literal('contact_field'),
      field: humanReferenceSchema,
      value: z.string(),
    }),
    z.strictObject({
      subject: z.literal('tag_presence'),
      tag: humanReferenceSchema,
    }),
    z.strictObject({
      subject: z.literal('message_content'),
      value: nonEmptyString,
    }),
    z.strictObject({
      subject: z.literal('time_of_day'),
      range: timeRangeSchema,
    }),
    z.strictObject({
      subject: z.literal('deal_stage'),
      pipeline: humanReferenceSchema,
      stage: humanReferenceSchema,
    }),
  ]
);

const branchSchema = z.enum(['yes', 'no']).nullable();
const parentIndexSchema = z.number().int().nonnegative().nullable();

function intentStep<
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

const intentStepSchemas = [
  intentStep(
    'send_message',
    z.strictObject({
      text: nonEmptyString,
    })
  ),
  intentStep(
    'send_buttons',
    z.strictObject({
      kind: z.literal('buttons'),
      body: nonEmptyString.max(1024),
      header: nonEmptyString.max(60).nullable(),
      footer: nonEmptyString.max(60).nullable(),
      buttons: z.array(intentButtonSchema).min(1).max(3),
    })
  ),
  intentStep('send_list', intentSendListConfigSchema),
  intentStep(
    'send_template',
    z.strictObject({
      template: humanReferenceSchema,
      language: nullableNonEmptyString,
      variables: requiredNullableStringMap,
    })
  ),
  intentStep(
    'add_tag',
    z.strictObject({
      tag: humanReferenceSchema,
    })
  ),
  intentStep(
    'remove_tag',
    z.strictObject({
      tag: humanReferenceSchema,
    })
  ),
  intentStep(
    'assign_conversation',
    z.discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('specific'),
        agent: humanReferenceSchema,
      }),
      z.strictObject({
        mode: z.literal('round_robin'),
        agent: z.null(),
      }),
    ])
  ),
  intentStep(
    'update_contact_field',
    z.strictObject({
      field: humanReferenceSchema,
      value: z.string(),
    })
  ),
  intentStep(
    'create_deal',
    z.strictObject({
      pipeline: humanReferenceSchema,
      stage: humanReferenceSchema,
      title: nonEmptyString,
      value: z.number().finite().nullable(),
    })
  ),
  intentStep(
    'move_deal_stage',
    z.strictObject({
      pipeline: humanReferenceSchema,
      stage: humanReferenceSchema,
    })
  ),
  intentStep(
    'wait',
    z.strictObject({
      amount: z.number().finite().positive(),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
  ),
  intentStep('condition', automationIntentConditionConfigSchema),
  intentStep(
    'send_webhook',
    z.strictObject({
      url: httpUrlSchema,
      headers: requiredNullableStringMap,
      body_template: z.string().nullable(),
    })
  ),
  intentStep('close_conversation', emptyConfigSchema),
] as const;

export const automationIntentStepSchema = z.discriminatedUnion(
  'step_type',
  intentStepSchemas
);

const automationIntentBase = {
  name: trimmedNonEmptyString.max(120),
  description: z.string().max(500).nullable(),
  steps: z.array(automationIntentStepSchema).min(1),
};

function automationIntent<
  const Type extends (typeof AUTOMATION_TRIGGER_TYPES)[number],
  Config extends z.ZodType,
>(triggerType: Type, triggerConfig: Config) {
  return z.strictObject({
    ...automationIntentBase,
    trigger_type: z.literal(triggerType),
    trigger_config: triggerConfig,
  });
}

const automationIntentSchemas = [
  automationIntent('new_message_received', emptyConfigSchema),
  automationIntent('first_inbound_message', emptyConfigSchema),
  automationIntent(
    'keyword_match',
    intentTriggerSchemas[2].shape.trigger_config
  ),
  automationIntent('new_contact_created', emptyConfigSchema),
  automationIntent('conversation_assigned', emptyConfigSchema),
  automationIntent('tag_added', intentTriggerSchemas[5].shape.trigger_config),
  automationIntent('time_based', intentTriggerSchemas[6].shape.trigger_config),
  automationIntent(
    'interactive_reply',
    intentTriggerSchemas[7].shape.trigger_config
  ),
  automationIntent(
    'deal_stage_changed',
    intentTriggerSchemas[8].shape.trigger_config
  ),
] as const;

export const automationIntentSchema = z.discriminatedUnion(
  'trigger_type',
  automationIntentSchemas
);

export type AutomationIntent = z.infer<typeof automationIntentSchema>;
export type AutomationIntentStep = z.infer<typeof automationIntentStepSchema>;
export type AutomationIntentTrigger = z.infer<
  typeof automationIntentTriggerSchema
>;
