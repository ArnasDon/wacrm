import { describe, expect, it } from 'vitest';
import {
  agentForTurn,
  rotationPool,
  type RotationMember,
} from './round-robin';

const MEMBERS: RotationMember[] = [
  { user_id: 'owner-1', role: 'owner' },
  { user_id: 'agent-a', role: 'agent' },
  { user_id: 'agent-b', role: 'agent' },
  { user_id: 'agent-c', role: 'agent' },
  { user_id: 'viewer-1', role: 'viewer' },
];

describe('rotationPool', () => {
  it('leaves owners and viewers out by default', () => {
    expect(rotationPool(MEMBERS)).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });

  it('includes admins alongside agents', () => {
    const pool = rotationPool([
      ...MEMBERS,
      { user_id: 'admin-1', role: 'admin' },
    ]);
    expect(pool).toContain('admin-1');
    expect(pool).not.toContain('owner-1');
  });

  it('honours an explicit member list, owners included', () => {
    expect(rotationPool(MEMBERS, ['agent-b', 'owner-1'])).toEqual([
      'agent-b',
      'owner-1',
    ]);
  });

  it('drops configured ids that are no longer members', () => {
    expect(rotationPool(MEMBERS, ['agent-a', 'departed'])).toEqual(['agent-a']);
  });

  it('falls back to the default pool when the list names nobody current', () => {
    expect(rotationPool(MEMBERS, ['departed'])).toEqual([
      'agent-a',
      'agent-b',
      'agent-c',
    ]);
  });

  it('falls back to the owner in an account with no other members', () => {
    expect(rotationPool([{ user_id: 'owner-1', role: 'owner' }])).toEqual([
      'owner-1',
    ]);
  });
});

describe('agentForTurn', () => {
  const pool = ['agent-a', 'agent-b', 'agent-c'];

  it('walks the pool in order and wraps around', () => {
    const picked = [0, 1, 2, 3, 4, 5].map((turn) => agentForTurn(pool, turn));
    expect(picked).toEqual([
      'agent-a',
      'agent-b',
      'agent-c',
      'agent-a',
      'agent-b',
      'agent-c',
    ]);
  });

  it('gives every member an equal share over a long run', () => {
    const counts = new Map<string, number>();
    for (let turn = 0; turn < 300; turn++) {
      const agent = agentForTurn(pool, turn)!;
      counts.set(agent, (counts.get(agent) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([100, 100, 100]);
  });

  it('returns undefined for an empty pool', () => {
    expect(agentForTurn([], 7)).toBeUndefined();
  });
});
