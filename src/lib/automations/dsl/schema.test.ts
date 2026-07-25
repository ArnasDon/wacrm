import { describe, expect, it } from 'vitest';
import { automationIntentSchema } from './intent';
import {
  AUTOMATION_STEP_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  generatedAutomationSchema,
} from './schema';

const root = { branch: null, parent_index: null } as const;
const fallbackStep = {
  step_type: 'send_message',
  step_config: { text: 'Hello' },
  ...root,
} as const;

describe('automationIntentSchema', () => {
  it('covers all 9 triggers with strict, human-reference configs', () => {
    const configs = {
      new_message_received: {},
      first_inbound_message: {},
      keyword_match: {
        keywords: ['budget'],
        match_type: 'contains',
        case_sensitive: null,
      },
      new_contact_created: {},
      conversation_assigned: {},
      tag_added: { tag: 'VIP' },
      time_based: { schedule: '09:00', timezone: null },
      interactive_reply: { reply_labels: ['Accept'] },
      deal_stage_changed: { pipeline: null },
    } as const;

    expect(Object.keys(configs)).toEqual(AUTOMATION_TRIGGER_TYPES);
    for (const trigger_type of AUTOMATION_TRIGGER_TYPES) {
      expect(
        automationIntentSchema.safeParse({
          name: trigger_type,
          description: null,
          trigger_type,
          trigger_config: configs[trigger_type],
          steps: [fallbackStep],
        }).success,
        trigger_type
      ).toBe(true);
    }
  });

  it('covers all 14 actions and all condition subjects', () => {
    const steps = [
      fallbackStep,
      {
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          body: 'Choose',
          header: null,
          footer: null,
          buttons: [{ title: 'Yes' }],
        },
        ...root,
      },
      {
        step_type: 'send_list',
        step_config: {
          kind: 'list',
          body: 'Choose',
          header: null,
          footer: null,
          button_label: 'Open',
          sections: [
            {
              title: null,
              rows: [{ title: 'First', description: null }],
            },
          ],
        },
        ...root,
      },
      {
        step_type: 'send_template',
        step_config: {
          template: 'welcome',
          language: 'en_US',
          variables: null,
        },
        ...root,
      },
      { step_type: 'add_tag', step_config: { tag: 'VIP' }, ...root },
      { step_type: 'remove_tag', step_config: { tag: 'VIP' }, ...root },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'specific', agent: 'Maria' },
        ...root,
      },
      {
        step_type: 'update_contact_field',
        step_config: { field: 'Segment', value: 'Enterprise' },
        ...root,
      },
      {
        step_type: 'create_deal',
        step_config: {
          pipeline: 'Sales',
          stage: 'Won',
          title: 'New deal',
          value: null,
        },
        ...root,
      },
      {
        step_type: 'move_deal_stage',
        step_config: { pipeline: 'Sales', stage: 'Won' },
        ...root,
      },
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'hours' },
        ...root,
      },
      {
        step_type: 'condition',
        step_config: { subject: 'message_content', value: 'budget' },
        ...root,
      },
      {
        step_type: 'send_webhook',
        step_config: {
          url: 'https://example.com/hook',
          headers: null,
          body_template: null,
        },
        ...root,
      },
      { step_type: 'close_conversation', step_config: {}, ...root },
    ] as const;

    expect(steps.map((step) => step.step_type)).toEqual(AUTOMATION_STEP_TYPES);
    expect(
      automationIntentSchema.safeParse({
        name: 'All actions',
        description: null,
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps,
      }).success
    ).toBe(true);

    const conditions = [
      { subject: 'contact_field', field: 'email', value: 'x@example.com' },
      { subject: 'tag_presence', tag: 'VIP' },
      { subject: 'message_content', value: 'budget' },
      { subject: 'time_of_day', range: '09:00-18:00' },
      { subject: 'deal_stage', pipeline: 'Sales', stage: 'Won' },
    ];
    for (const step_config of conditions) {
      expect(
        automationIntentSchema.safeParse({
          name: 'Condition',
          description: null,
          trigger_type: 'new_message_received',
          trigger_config: {},
          steps: [{ step_type: 'condition', step_config, ...root }],
        }).success,
        JSON.stringify(step_config)
      ).toBe(true);
    }
  });

  it('requires nullable keys and rejects unknown or legacy config keys', () => {
    const missingNullable = {
      name: 'Buttons',
      description: null,
      trigger_type: 'new_message_received',
      trigger_config: {},
      steps: [
        {
          step_type: 'send_buttons',
          step_config: {
            kind: 'buttons',
            body: 'Choose',
            footer: null,
            buttons: [{ title: 'Yes' }],
          },
          ...root,
        },
      ],
    };
    expect(automationIntentSchema.safeParse(missingNullable).success).toBe(
      false
    );

    expect(
      automationIntentSchema.safeParse({
        name: 'Legacy',
        description: null,
        trigger_type: 'keyword_match',
        trigger_config: {
          keyword: 'budget',
          keywords: ['budget'],
          match_type: 'contains',
          case_sensitive: null,
        },
        steps: [fallbackStep],
      }).success
    ).toBe(false);
  });

  it('uses names instead of UUIDs and enforces assign mode/agent pairs', () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    expect(
      automationIntentSchema.safeParse({
        name: 'No ids',
        description: null,
        trigger_type: 'tag_added',
        trigger_config: { tag: uuid },
        steps: [fallbackStep],
      }).success
    ).toBe(false);

    for (const step_config of [
      { mode: 'specific', agent: null },
      { mode: 'round_robin', agent: 'Maria' },
    ]) {
      expect(
        automationIntentSchema.safeParse({
          name: 'Assign',
          description: null,
          trigger_type: 'new_message_received',
          trigger_config: {},
          steps: [
            {
              step_type: 'assign_conversation',
              step_config,
              ...root,
            },
          ],
        }).success,
        JSON.stringify(step_config)
      ).toBe(false);
    }

    expect(
      automationIntentSchema.safeParse({
        name: 'Round robin',
        description: null,
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps: [
          {
            step_type: 'assign_conversation',
            step_config: { mode: 'round_robin', agent: null },
            ...root,
          },
        ],
      }).success
    ).toBe(true);
  });

  it('enforces WhatsApp interactive limits before compilation', () => {
    expect(
      automationIntentSchema.safeParse({
        name: 'Too many',
        description: null,
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps: [
          {
            step_type: 'send_buttons',
            step_config: {
              kind: 'buttons',
              body: 'Choose',
              header: null,
              footer: null,
              buttons: ['A', 'B', 'C', 'D'].map((title) => ({ title })),
            },
            ...root,
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe('generatedAutomationSchema', () => {
  it('accepts the exact compiled runtime format and rejects extra keys', () => {
    const generated = {
      name: 'Canonical',
      description: '',
      trigger_type: 'keyword_match',
      trigger_config: {
        keywords: ['budget'],
        match_type: 'contains',
      },
      steps: [
        {
          step_type: 'wait',
          step_config: { amount: 1, unit: 'hours' },
          ...root,
        },
      ],
    };
    expect(generatedAutomationSchema.safeParse(generated).success).toBe(true);
    expect(
      generatedAutomationSchema.safeParse({
        ...generated,
        trigger_config: { ...generated.trigger_config, keyword: 'budget' },
      }).success
    ).toBe(false);
  });

  it('covers all 9 trigger and 14 action runtime shapes', () => {
    const triggerConfigs = {
      new_message_received: {},
      first_inbound_message: {},
      keyword_match: {
        keywords: ['budget'],
        match_type: 'contains',
        case_sensitive: false,
      },
      new_contact_created: {},
      conversation_assigned: {},
      tag_added: { tag_id: 'tag-vip' },
      time_based: { schedule: '09:00', timezone: 'America/Sao_Paulo' },
      interactive_reply: { reply_ids: ['accept'] },
      deal_stage_changed: { pipeline_id: 'pipeline-sales' },
    } as const;
    const steps = [
      fallbackStep,
      {
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          body: 'Choose',
          buttons: [{ id: 'button_yes', title: 'Yes' }],
        },
        ...root,
      },
      {
        step_type: 'send_list',
        step_config: {
          kind: 'list',
          body: 'Choose',
          button_label: 'Open',
          sections: [
            {
              rows: [{ id: 'row_first', title: 'First' }],
            },
          ],
        },
        ...root,
      },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'welcome',
          language: 'en_US',
          variables: { '1': '{{ contact.name }}' },
        },
        ...root,
      },
      { step_type: 'add_tag', step_config: { tag_id: 'tag-vip' }, ...root },
      { step_type: 'remove_tag', step_config: { tag_id: 'tag-vip' }, ...root },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'specific', agent_id: 'agent-maria' },
        ...root,
      },
      {
        step_type: 'update_contact_field',
        step_config: { field: 'custom:field-segment', value: 'Enterprise' },
        ...root,
      },
      {
        step_type: 'create_deal',
        step_config: {
          pipeline_id: 'pipeline-sales',
          stage_id: 'stage-won',
          title: 'New deal',
          value: 100,
        },
        ...root,
      },
      {
        step_type: 'move_deal_stage',
        step_config: {
          pipeline_id: 'pipeline-sales',
          stage_id: 'stage-won',
        },
        ...root,
      },
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'hours' },
        ...root,
      },
      {
        step_type: 'condition',
        step_config: { subject: 'message_content', value: 'budget' },
        ...root,
      },
      {
        step_type: 'send_webhook',
        step_config: { url: 'https://example.com/hook' },
        ...root,
      },
      { step_type: 'close_conversation', step_config: {}, ...root },
    ] as const;

    expect(steps.map((step) => step.step_type)).toEqual(AUTOMATION_STEP_TYPES);
    expect(Object.keys(triggerConfigs)).toEqual(AUTOMATION_TRIGGER_TYPES);
    for (const trigger_type of AUTOMATION_TRIGGER_TYPES) {
      expect(
        generatedAutomationSchema.safeParse({
          name: trigger_type,
          description: '',
          trigger_type,
          trigger_config: triggerConfigs[trigger_type],
          steps,
        }).success,
        trigger_type
      ).toBe(true);
    }
  });

  it('rejects invalid parents and duplicate interactive ids across steps', () => {
    const base = {
      name: 'Invalid graph',
      description: '',
      trigger_type: 'new_message_received',
      trigger_config: {},
    } as const;

    expect(
      generatedAutomationSchema.safeParse({
        ...base,
        steps: [
          fallbackStep,
          {
            step_type: 'send_message',
            step_config: { text: 'Child' },
            branch: 'yes',
            parent_index: 0,
          },
        ],
      }).success
    ).toBe(false);

    expect(
      generatedAutomationSchema.safeParse({
        ...base,
        steps: [
          {
            step_type: 'send_buttons',
            step_config: {
              kind: 'buttons',
              body: 'First',
              buttons: [{ id: 'duplicate', title: 'Yes' }],
            },
            ...root,
          },
          {
            step_type: 'send_list',
            step_config: {
              kind: 'list',
              body: 'Second',
              button_label: 'Open',
              sections: [{ rows: [{ id: 'duplicate', title: 'Yes' }] }],
            },
            ...root,
          },
        ],
      }).success
    ).toBe(false);
  });
});
