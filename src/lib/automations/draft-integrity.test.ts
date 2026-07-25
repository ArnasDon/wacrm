import { describe, expect, it } from 'vitest';
import { hashAutomationDraft } from './draft-integrity';

const DRAFT = {
  name: 'Welcome',
  description: '',
  trigger_type: 'keyword_match' as const,
  trigger_config: {
    keywords: ['hello'],
    match_type: 'exact' as const,
    case_sensitive: false,
  },
  steps: [
    {
      step_type: 'send_message' as const,
      step_config: { text: 'Hi!' },
      branch: null,
      parent_index: null,
    },
  ],
};

describe('hashAutomationDraft', () => {
  it('returns the same SHA-256 for equivalent drafts with reordered object keys', () => {
    const reordered = {
      steps: [
        {
          parent_index: null,
          branch: null,
          step_config: { text: 'Hi!' },
          step_type: 'send_message' as const,
        },
      ],
      trigger_config: {
        case_sensitive: false,
        match_type: 'exact' as const,
        keywords: ['hello'],
      },
      trigger_type: 'keyword_match' as const,
      description: '',
      name: 'Welcome',
    };

    expect(hashAutomationDraft(reordered)).toBe(hashAutomationDraft(DRAFT));
    expect(hashAutomationDraft(DRAFT)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when any persisted automation behavior changes', () => {
    const changed = {
      ...DRAFT,
      steps: [
        {
          ...DRAFT.steps[0],
          step_config: { text: 'Different reply' },
        },
      ],
    };

    expect(hashAutomationDraft(changed)).not.toBe(hashAutomationDraft(DRAFT));
  });
});
