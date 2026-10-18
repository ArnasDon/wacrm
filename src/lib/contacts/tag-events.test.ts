import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('./tag-write', () => ({
  addContactTagIfAbsent: mocks.add,
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.dispatch,
}));

import {
  addContactTagAndDispatch,
  getTagChainDepth,
  MAX_TAG_CHAIN_DEPTH,
} from './tag-events';

const base = {
  db: {} as never,
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

beforeEach(() => {
  mocks.add.mockReset();
  mocks.dispatch.mockReset();
  mocks.dispatch.mockResolvedValue(undefined);
});

describe('addContactTagAndDispatch', () => {
  it('dispatches once for a newly inserted tag and propagates depth', async () => {
    mocks.add.mockResolvedValue(true);

    const result = await addContactTagAndDispatch({
      ...base,
      context: { vars: { source: 'flow', _tag_chain_depth: 1 } },
    });

    expect(result).toEqual({ added: true, dispatched: true });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      accountId: 'account-1',
      triggerType: 'tag_added',
      contactId: 'contact-1',
      context: {
        tag_id: 'tag-1',
        vars: { source: 'flow', _tag_chain_depth: 2 },
      },
    });
  });

  it('does not dispatch when the tag already exists', async () => {
    mocks.add.mockResolvedValue(false);

    await expect(addContactTagAndDispatch(base)).resolves.toEqual({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('adds the tag but cuts a chain at the configured depth limit', async () => {
    mocks.add.mockResolvedValue(true);

    await expect(
      addContactTagAndDispatch({
        ...base,
        context: { vars: { _tag_chain_depth: MAX_TAG_CHAIN_DEPTH } },
      })
    ).resolves.toEqual({
      added: true,
      dispatched: false,
      reason: 'max_depth',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('cuts an A-to-B-to-A tag chain before it can loop forever', async () => {
    mocks.add.mockResolvedValue(true);
    mocks.dispatch.mockImplementation(async (event) => {
      const nextTag = event.context.tag_id === 'tag-a' ? 'tag-b' : 'tag-a';
      await addContactTagAndDispatch({
        ...base,
        tagId: nextTag,
        context: event.context,
      });
    });

    await addContactTagAndDispatch({ ...base, tagId: 'tag-a' });

    expect(mocks.dispatch).toHaveBeenCalledTimes(MAX_TAG_CHAIN_DEPTH);
    expect(mocks.add).toHaveBeenCalledTimes(MAX_TAG_CHAIN_DEPTH + 1);
  });
});

describe('getTagChainDepth', () => {
  it('normalizes missing, invalid and fractional values', () => {
    expect(getTagChainDepth()).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: '3' } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: -1 } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: 2.8 } })).toBe(2);
  });
});
