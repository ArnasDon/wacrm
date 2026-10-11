import { describe, expect, it } from 'vitest';
import { parseManualRecipients, normalizePhoneWithCountry } from './parse-manual-recipients';

describe('normalizePhoneWithCountry', () => {
  it('adds 55 to a 10-digit number without country code', () => {
    expect(normalizePhoneWithCountry('8332145678')).toBe('558332145678');
  });

  it('adds 55 to an 11-digit number without country code', () => {
    expect(normalizePhoneWithCountry('83988887777')).toBe('5583988887777');
  });

  it('preserves numbers that already have country code 55', () => {
    expect(normalizePhoneWithCountry('5583988887777')).toBe('5583988887777');
    expect(normalizePhoneWithCountry('+55 83 98888-7777')).toBe('5583988887777');
  });

  it('returns null for too short strings', () => {
    expect(normalizePhoneWithCountry('12345')).toBeNull();
  });
});

describe('parseManualRecipients', () => {
  it('parses a single phone number', () => {
    const list = parseManualRecipients('83988887777');
    expect(list).toEqual([{ nome: null, telefone: '5583988887777' }]);
  });

  it('parses formatted phone with parentheses and dashes', () => {
    const list = parseManualRecipients('(83) 98888-7777');
    expect(list).toEqual([{ nome: null, telefone: '5583988887777' }]);
  });

  it('parses name and phone in "Name, Phone" format', () => {
    const list = parseManualRecipients('Ronaldo Meira, 83988887777');
    expect(list).toEqual([{ nome: 'Ronaldo Meira', telefone: '5583988887777' }]);
  });

  it('parses name and phone in "Name - Phone" format', () => {
    const list = parseManualRecipients('Carlos Silva - (11) 97777-6666');
    expect(list).toEqual([{ nome: 'Carlos Silva', telefone: '5511977776666' }]);
  });

  it('parses multiline inputs with deduplication', () => {
    const input = `
      83988887777
      (83) 98888-7777
      Maria, 21999998888
      (31) 98765-4321
    `;
    const list = parseManualRecipients(input);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ nome: null, telefone: '5583988887777' });
    expect(list[1]).toEqual({ nome: 'Maria', telefone: '5521999998888' });
    expect(list[2]).toEqual({ nome: null, telefone: '5531987654321' });
  });

  it('parses comma-separated numbers on a single line', () => {
    const list = parseManualRecipients('83988881111, 83988882222; 83988883333');
    expect(list).toHaveLength(3);
    expect(list.map((r) => r.telefone)).toEqual([
      '5583988881111',
      '5583988882222',
      '5583988883333',
    ]);
  });
});
