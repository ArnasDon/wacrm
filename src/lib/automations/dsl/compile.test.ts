import { describe, expect, it } from 'vitest';
import {
  compileAutomationIntent,
  type AutomationCompilationResources,
} from './compile';
import { AUTOMATION_STEP_TYPES, AUTOMATION_TRIGGER_TYPES } from './schema';

const resources: AutomationCompilationResources = {
  tags: [
    { id: 'tag-vip', name: 'VIP' },
    { id: 'tag-promo', name: 'Promoção' },
  ],
  members: [{ id: 'agent-maria', name: 'Maria Silva' }],
  customFields: [
    {
      id: 'field-segment',
      name: 'Segmento',
      type: 'select',
      options: ['Enterprise', 'SMB'],
    },
    {
      id: 'field-score',
      name: 'Pontuação',
      type: 'number',
      options: [],
    },
    {
      id: 'field-date',
      name: 'Data de renovação',
      type: 'date',
      options: [],
    },
  ],
  pipelines: [
    {
      id: 'pipeline-sales',
      name: 'Vendas',
      stages: [
        { id: 'stage-qualified', name: 'Qualificação' },
        { id: 'stage-won', name: 'Fechado' },
      ],
    },
    {
      id: 'pipeline-support',
      name: 'Suporte',
      stages: [{ id: 'stage-support-closed', name: 'Encerrado' }],
    },
  ],
  templates: [
    { id: 'template-budget-pt', name: 'Orçamento', language: 'pt_BR' },
    { id: 'template-budget-en', name: 'Orçamento', language: 'en_US' },
  ],
  interactiveReplies: [
    { id: 'accept', label: 'Aceitar' },
    { id: 'details', label: 'Ver detalhes' },
  ],
};

const root = { branch: null, parent_index: null } as const;

function intent(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name: 'Automation',
    description: null,
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: { text: 'Hello' },
        ...root,
      },
    ],
    ...overrides,
  };
}

describe('compileAutomationIntent resource resolution', () => {
  it('compiles all 9 trigger variants to their canonical runtime shapes', () => {
    const triggerConfigs: Record<string, Record<string, unknown>> = {
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
      interactive_reply: { reply_labels: ['Aceitar'] },
      deal_stage_changed: { pipeline: 'Vendas' },
    };

    expect(Object.keys(triggerConfigs)).toEqual(AUTOMATION_TRIGGER_TYPES);
    for (const trigger_type of AUTOMATION_TRIGGER_TYPES) {
      const result = compileAutomationIntent(
        intent({
          trigger_type,
          trigger_config: triggerConfigs[trigger_type],
        }),
        resources
      );
      expect(result.kind, trigger_type).toBe('draft');
    }
  });

  it('uses exact trimmed matches before accent/case/space normalization', () => {
    const exactResources = {
      ...resources,
      tags: [
        { id: 'tag-accented', name: 'Café' },
        { id: 'tag-ascii', name: 'Cafe' },
      ],
    };

    const exact = compileAutomationIntent(
      intent({
        trigger_type: 'tag_added',
        trigger_config: { tag: '  Café  ' },
      }),
      exactResources
    );
    expect(exact).toMatchObject({
      kind: 'draft',
      automation: { trigger_config: { tag_id: 'tag-accented' } },
    });

    const ambiguous = compileAutomationIntent(
      intent({
        trigger_type: 'tag_added',
        trigger_config: { tag: 'CAFE' },
      }),
      exactResources
    );
    expect(ambiguous).toEqual({
      kind: 'question',
      text: expect.any(String),
      reasonCode: 'resource_ambiguous',
      choices: ['Café', 'Cafe'],
    });

    const normalized = compileAutomationIntent(
      intent({
        trigger_type: 'tag_added',
        trigger_config: { tag: '  pro mocao ' },
      }),
      resources
    );
    expect(normalized).toMatchObject({
      kind: 'draft',
      automation: { trigger_config: { tag_id: 'tag-promo' } },
    });

    const notFuzzy = compileAutomationIntent(
      intent({
        trigger_type: 'tag_added',
        trigger_config: { tag: 'VI' },
      }),
      resources
    );
    expect(notFuzzy).toMatchObject({
      kind: 'question',
      reasonCode: 'resource_not_found',
      choices: ['VIP', 'Promoção'],
    });
  });

  it('asks for missing resources and never emits empty ids', () => {
    const result = compileAutomationIntent(
      intent({
        trigger_type: 'tag_added',
        trigger_config: { tag: 'Does not exist' },
      }),
      resources
    );
    expect(result).toEqual({
      kind: 'question',
      text: expect.any(String),
      reasonCode: 'resource_not_found',
      choices: ['VIP', 'Promoção'],
    });
    expect(JSON.stringify(result)).not.toContain('tag_id":""');
  });

  it('resolves agents and known interactive reply labels by human name', () => {
    const assigned = compileAutomationIntent(
      intent({
        trigger_type: 'interactive_reply',
        trigger_config: { reply_labels: ['aceitar', 'VERDETALHES'] },
        steps: [
          {
            step_type: 'assign_conversation',
            step_config: { mode: 'specific', agent: 'maria  silva' },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(assigned).toMatchObject({
      kind: 'draft',
      automation: {
        trigger_config: { reply_ids: ['accept', 'details'] },
        steps: [
          {
            step_config: { mode: 'specific', agent_id: 'agent-maria' },
          },
        ],
      },
    });
  });

  it('resolves stages only inside the selected pipeline', () => {
    const valid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'move_deal_stage',
            step_config: { pipeline: 'vendas', stage: 'qualificacao' },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(valid).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          {
            step_config: {
              pipeline_id: 'pipeline-sales',
              stage_id: 'stage-qualified',
            },
          },
        ],
      },
    });

    const wrongPipeline = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'move_deal_stage',
            step_config: { pipeline: 'Vendas', stage: 'Encerrado' },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(wrongPipeline).toMatchObject({
      kind: 'question',
      reasonCode: 'resource_not_found',
      choices: ['Qualificação', 'Fechado'],
    });
  });

  it('requires both template name and language and compiles the canonical pair', () => {
    const missingLanguage = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'send_template',
            step_config: {
              template: 'Orçamento',
              language: null,
              variables: null,
            },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(missingLanguage).toMatchObject({
      kind: 'question',
      reasonCode: 'missing_reference',
      choices: ['pt_BR', 'en_US'],
    });

    const compiled = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'send_template',
            step_config: {
              template: 'orcamento',
              language: 'PT_BR',
              variables: { '1': '{{ contact.name }}' },
            },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(compiled).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          {
            step_config: {
              template_name: 'Orçamento',
              language: 'pt_BR',
              variables: { '1': '{{ contact.name }}' },
            },
          },
        ],
      },
    });

    const singleLanguage = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'send_template',
            step_config: {
              template: 'Welcome',
              language: null,
              variables: null,
            },
            ...root,
          },
        ],
      }),
      {
        ...resources,
        templates: [
          { id: 'template-welcome-en', name: 'Welcome', language: 'en_US' },
        ],
      }
    );
    expect(singleLanguage).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          {
            step_config: {
              template_name: 'Welcome',
              language: 'en_US',
            },
          },
        ],
      },
    });
  });
});

describe('compileAutomationIntent values, branches, and safety', () => {
  it('compiles all 14 action variants and preserves their declared order', () => {
    const allActions = [
      {
        step_type: 'send_message',
        step_config: { text: 'Hello' },
        ...root,
      },
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
          template: 'Orçamento',
          language: 'pt_BR',
          variables: null,
        },
        ...root,
      },
      { step_type: 'add_tag', step_config: { tag: 'VIP' }, ...root },
      { step_type: 'remove_tag', step_config: { tag: 'VIP' }, ...root },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'specific', agent: 'Maria Silva' },
        ...root,
      },
      {
        step_type: 'update_contact_field',
        step_config: { field: 'Segmento', value: 'Enterprise' },
        ...root,
      },
      {
        step_type: 'create_deal',
        step_config: {
          pipeline: 'Vendas',
          stage: 'Fechado',
          title: 'New deal',
          value: null,
        },
        ...root,
      },
      {
        step_type: 'move_deal_stage',
        step_config: { pipeline: 'Vendas', stage: 'Fechado' },
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
          url: 'https://hooks.example.com/in',
          headers: null,
          body_template: null,
        },
        ...root,
      },
      { step_type: 'close_conversation', step_config: {}, ...root },
    ];

    expect(allActions.map((step) => step.step_type)).toEqual(
      AUTOMATION_STEP_TYPES
    );
    const result = compileAutomationIntent(
      intent({ steps: allActions }),
      resources
    );
    expect(result.kind).toBe('draft');
    if (result.kind !== 'draft') return;
    expect(result.automation.steps.map((step) => step.step_type)).toEqual(
      AUTOMATION_STEP_TYPES
    );
  });

  it('compiles custom fields to custom:<id>, preserves TEXT, and validates static values', () => {
    const valid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'update_contact_field',
            step_config: { field: 'segmento', value: 'enterprise' },
            ...root,
          },
          {
            step_type: 'update_contact_field',
            step_config: { field: 'PONTUACAO', value: '{{ vars.score }}' },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(valid).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          {
            step_config: {
              field: 'custom:field-segment',
              value: 'Enterprise',
            },
          },
          {
            step_config: {
              field: 'custom:field-score',
              value: '{{ vars.score }}',
            },
          },
        ],
      },
    });

    const invalid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'update_contact_field',
            step_config: { field: 'Pontuação', value: 'not-a-number' },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(invalid).toMatchObject({
      kind: 'question',
      reasonCode: 'invalid_custom_field_value',
    });

    const condition = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'condition',
            step_config: {
              subject: 'contact_field',
              field: 'segmento',
              value: 'smb',
            },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(condition).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          {
            step_config: {
              subject: 'contact_field',
              operand: 'custom:field-segment',
              value: 'SMB',
            },
          },
        ],
      },
    });
  });

  it('enforces assign mode/agent pairs before resource compilation', () => {
    for (const step_config of [
      { mode: 'specific', agent: null },
      { mode: 'round_robin', agent: 'Maria Silva' },
    ]) {
      expect(
        compileAutomationIntent(
          intent({
            steps: [
              {
                step_type: 'assign_conversation',
                step_config,
                ...root,
              },
            ],
          }),
          resources
        )
      ).toMatchObject({
        kind: 'question',
        reasonCode: 'invalid_intent',
      });
    }

    expect(
      compileAutomationIntent(
        intent({
          steps: [
            {
              step_type: 'assign_conversation',
              step_config: { mode: 'round_robin', agent: null },
              ...root,
            },
          ],
        }),
        resources
      )
    ).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [{ step_config: { mode: 'round_robin' } }],
      },
    });
  });

  it('generates stable unique ids for buttons and list rows', () => {
    const interactiveIntent = intent({
      steps: [
        {
          step_type: 'send_buttons',
          step_config: {
            kind: 'buttons',
            body: 'Choose',
            header: null,
            footer: null,
            buttons: [{ title: 'Same' }, { title: 'Same' }],
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
                rows: [
                  { title: 'Same', description: null },
                  { title: 'Same', description: null },
                ],
              },
            ],
          },
          ...root,
        },
      ],
    });

    const first = compileAutomationIntent(interactiveIntent, resources);
    const second = compileAutomationIntent(interactiveIntent, resources);
    expect(first).toEqual(second);
    expect(first.kind).toBe('draft');
    if (first.kind !== 'draft') return;
    const ids = first.automation.steps.flatMap((step) => {
      if (step.step_type === 'send_buttons') {
        return step.step_config.buttons.map((button) => button.id);
      }
      if (step.step_type === 'send_list') {
        return step.step_config.sections.flatMap((section) =>
          section.rows.map((row) => row.id)
        );
      }
      return [];
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Boolean)).toBe(true);
  });

  it('preserves valid branches and asks when parent_index is not an earlier condition', () => {
    const valid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'condition',
            step_config: { subject: 'message_content', value: 'budget' },
            ...root,
          },
          {
            step_type: 'send_message',
            step_config: { text: 'Yes' },
            branch: 'yes',
            parent_index: 0,
          },
          {
            step_type: 'close_conversation',
            step_config: {},
            branch: 'no',
            parent_index: 0,
          },
        ],
      }),
      resources
    );
    expect(valid).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          { step_type: 'condition', branch: null, parent_index: null },
          { step_type: 'send_message', branch: 'yes', parent_index: 0 },
          { step_type: 'close_conversation', branch: 'no', parent_index: 0 },
        ],
      },
    });

    const invalid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'send_message',
            step_config: { text: 'Root' },
            ...root,
          },
          {
            step_type: 'wait',
            step_config: { amount: 1, unit: 'hours' },
            branch: 'yes',
            parent_index: 0,
          },
        ],
      }),
      resources
    );
    expect(invalid).toMatchObject({
      kind: 'question',
      reasonCode: 'invalid_parent',
    });
  });

  it('requires an explicit HTTP(S) webhook URL and never invents headers or secrets', () => {
    const valid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'send_webhook',
            step_config: {
              url: 'https://hooks.example.com/in',
              headers: null,
              body_template: null,
            },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(valid).toMatchObject({
      kind: 'draft',
      automation: {
        steps: [
          {
            step_config: { url: 'https://hooks.example.com/in' },
          },
        ],
      },
    });
    if (valid.kind === 'draft') {
      expect(valid.automation.steps[0].step_config).toEqual({
        url: 'https://hooks.example.com/in',
      });
    }

    const invalid = compileAutomationIntent(
      intent({
        steps: [
          {
            step_type: 'send_webhook',
            step_config: {
              url: 'ftp://files.example.com/in',
              headers: null,
              body_template: null,
            },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(invalid).toMatchObject({
      kind: 'question',
      reasonCode: 'invalid_intent',
    });
  });

  it('rejects the keyword/message/duration regression instead of emitting an empty draft', () => {
    const regression = compileAutomationIntent(
      intent({
        trigger_type: 'keyword_match',
        trigger_config: { keyword: 'budget' },
        steps: [
          {
            step_type: 'send_message',
            step_config: { message: 'Hello' },
            ...root,
          },
          {
            step_type: 'wait',
            step_config: { duration: '1h' },
            branch: null,
            parent_index: 0,
          },
        ],
      }),
      resources
    );
    expect(regression).toMatchObject({
      kind: 'question',
      reasonCode: 'invalid_intent',
    });

    const canonical = compileAutomationIntent(
      intent({
        trigger_type: 'keyword_match',
        trigger_config: {
          keywords: ['budget'],
          match_type: 'contains',
          case_sensitive: null,
        },
        steps: [
          {
            step_type: 'send_message',
            step_config: { text: 'Hello' },
            ...root,
          },
          {
            step_type: 'wait',
            step_config: { amount: 1, unit: 'hours' },
            ...root,
          },
        ],
      }),
      resources
    );
    expect(canonical).toMatchObject({
      kind: 'draft',
      automation: {
        trigger_config: {
          keywords: ['budget'],
          match_type: 'contains',
        },
        steps: [
          { step_config: { text: 'Hello' } },
          { step_config: { amount: 1, unit: 'hours' } },
        ],
      },
    });
  });
});
