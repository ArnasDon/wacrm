import { describe, expect, it } from 'vitest';
import { parseCampaignFile } from './parse-campaign-file';

function fileWith(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    campaign: { name: 'Campanha teste' },
    creative: { url: 'https://example.com/img.png' },
    recipients: [
      { name: 'Ana', phone: '5511900000001', message: 'Oi Ana', order: 1 },
      { name: 'Bruno', phone: '5511900000002', message: 'Oi Bruno', order: 2 },
    ],
    ...overrides,
  });
}

describe('parseCampaignFile — legacy per-recipient message', () => {
  it('parses recipients with their own message and no variants', () => {
    const parsed = parseCampaignFile(fileWith());
    expect(parsed.variants).toBeNull();
    expect(parsed.leads).toEqual([
      { nome: 'Ana', telefone: '5511900000001', mensagem: 'Oi Ana' },
      { nome: 'Bruno', telefone: '5511900000002', mensagem: 'Oi Bruno' },
    ]);
  });

  it('requires recipients[i].message when messages is absent', () => {
    expect(() =>
      parseCampaignFile(
        fileWith({
          recipients: [{ name: 'Ana', phone: '5511900000001', order: 1 }],
        }),
      ),
    ).toThrow(/message ausente/);
  });

  it('sorts leads by recipients[i].order', () => {
    const parsed = parseCampaignFile(
      fileWith({
        recipients: [
          { name: 'Bruno', phone: '2', message: 'B', order: 2 },
          { name: 'Ana', phone: '1', message: 'A', order: 1 },
        ],
      }),
    );
    expect(parsed.leads.map((l) => l.nome)).toEqual(['Ana', 'Bruno']);
  });
});

describe('parseCampaignFile — messages variants (A/B/C+)', () => {
  it('exposes trimmed variants and ignores recipient-level message', () => {
    const parsed = parseCampaignFile(
      fileWith({
        messages: [' Variante A ', 'Variante B'],
        recipients: [
          { name: 'Ana', phone: '1', order: 1 },
          { name: 'Bruno', phone: '2', order: 2 },
        ],
      }),
    );
    expect(parsed.variants).toEqual(['Variante A', 'Variante B']);
    expect(parsed.leads.every((l) => l.mensagem === null)).toBe(true);
  });

  it('does not require recipients[i].message when messages is present', () => {
    expect(() =>
      parseCampaignFile(
        fileWith({
          messages: ['Variante A'],
          recipients: [{ name: 'Ana', phone: '1', order: 1 }],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects an empty messages array', () => {
    expect(() => parseCampaignFile(fileWith({ messages: [] }))).toThrow(/messages/);
  });

  it('rejects a blank entry inside messages', () => {
    expect(() => parseCampaignFile(fileWith({ messages: ['Variante A', '   '] }))).toThrow(/messages\[1\]/);
  });
});

describe('parseCampaignFile — required fields', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseCampaignFile('not json')).toThrow(/JSON válido/);
  });

  it('rejects a missing campaign.name', () => {
    expect(() => parseCampaignFile(fileWith({ campaign: {} }))).toThrow(/campaign.name/);
  });

  it('rejects a missing creative.url', () => {
    expect(() => parseCampaignFile(fileWith({ creative: {} }))).toThrow(/creative.url/);
  });

  it('rejects an empty recipients array', () => {
    expect(() => parseCampaignFile(fileWith({ recipients: [] }))).toThrow(/recipients/);
  });

  it('rejects a recipient with no phone', () => {
    expect(() => parseCampaignFile(fileWith({ recipients: [{ message: 'Oi', order: 1 }] }))).toThrow(/phone ausente/);
  });
});
