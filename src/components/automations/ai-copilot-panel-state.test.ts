import { describe, expect, it } from 'vitest';

import {
  canCreateCopilotDraft,
  shouldSendCopilotMessageFromKeydown,
} from './ai-copilot-panel-state';

describe('canCreateCopilotDraft', () => {
  it('allows only a verified, issue-free draft with a generation id', () => {
    expect(
      canCreateCopilotDraft({
        draft: {
          generation_id: 'generation-1',
          verified: true,
          issues: [],
        },
        hasPendingQuestion: false,
        lastTurnKind: 'draft',
      })
    ).toBe(true);

    expect(
      canCreateCopilotDraft({
        draft: {
          generation_id: 'generation-1',
          verified: false,
          issues: [],
        },
        hasPendingQuestion: false,
        lastTurnKind: 'draft',
      })
    ).toBe(false);
    expect(
      canCreateCopilotDraft({
        draft: {
          generation_id: 'generation-1',
          verified: true,
          issues: [{ message: 'invalid step' }],
        },
        hasPendingQuestion: false,
        lastTurnKind: 'draft',
      })
    ).toBe(false);
    expect(
      canCreateCopilotDraft({
        draft: {
          generation_id: '   ',
          verified: true,
          issues: [],
        },
        hasPendingQuestion: false,
        lastTurnKind: 'draft',
      })
    ).toBe(false);
    expect(
      canCreateCopilotDraft({
        draft: {
          generation_id: 'generation-1',
          verified: true,
          issues: [],
        },
        hasPendingQuestion: true,
        lastTurnKind: 'question',
      }),
    ).toBe(false);
    expect(
      canCreateCopilotDraft({
        draft: {
          generation_id: 'generation-1',
          verified: true,
          issues: [],
        },
        hasPendingQuestion: false,
        lastTurnKind: null,
      }),
    ).toBe(false);
    expect(canCreateCopilotDraft(null)).toBe(false);
  });
});

describe('shouldSendCopilotMessageFromKeydown', () => {
  it('submits only on a non-composing Enter press with a real message', () => {
    expect(
      shouldSendCopilotMessageFromKeydown({
        key: 'Enter',
        isComposing: false,
        sending: false,
        creating: false,
        value: 'Add a VIP tag',
      }),
    ).toBe(true);

    expect(
      shouldSendCopilotMessageFromKeydown({
        key: 'Enter',
        isComposing: true,
        sending: false,
        creating: false,
        value: '안녕하세요',
      }),
    ).toBe(false);
    expect(
      shouldSendCopilotMessageFromKeydown({
        key: 'Enter',
        isComposing: false,
        sending: true,
        creating: false,
        value: 'Add a VIP tag',
      }),
    ).toBe(false);
    expect(
      shouldSendCopilotMessageFromKeydown({
        key: 'Enter',
        isComposing: false,
        sending: false,
        creating: true,
        value: 'Add a VIP tag',
      }),
    ).toBe(false);
    expect(
      shouldSendCopilotMessageFromKeydown({
        key: 'Enter',
        isComposing: false,
        sending: false,
        creating: false,
        value: '   ',
      }),
    ).toBe(false);
    expect(
      shouldSendCopilotMessageFromKeydown({
        key: 'Escape',
        isComposing: false,
        sending: false,
        creating: false,
        value: 'Add a VIP tag',
      }),
    ).toBe(false);
  });
});
