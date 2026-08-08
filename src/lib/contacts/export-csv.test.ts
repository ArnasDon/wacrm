import { describe, expect, it } from 'vitest';
import { contactsToCsv, type ExportableContact } from './export-csv';
import type { Tag } from '@/types';

function tag(id: string, name: string): Tag {
  return { id, name, color: '#000', user_id: 'u', created_at: '' };
}

describe('contactsToCsv', () => {
  it('writes the Portuguese header row', () => {
    const csv = contactsToCsv([]);
    const [header] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('Nome,Telefone,Email,Empresa,Tags,CriadoEm');
  });

  it('prefixes the file with a UTF-8 BOM', () => {
    const csv = contactsToCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('normalizes phone to digits only, dropping + and formatting', () => {
    const contact: ExportableContact = {
      phone: '+55 (83) 99650-7373',
      created_at: '2026-08-07T12:00:00Z',
    };
    const csv = contactsToCsv([contact]);
    const [, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(row).toContain('5583996507373');
  });

  it('joins multiple tags with a semicolon', () => {
    const contact: ExportableContact = {
      phone: '5583996507373',
      created_at: '2026-08-07T12:00:00Z',
      tags: [tag('1', 'VIP'), tag('2', 'Lead')],
    };
    const csv = contactsToCsv([contact]);
    const [, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(row).toContain('VIP;Lead');
  });

  it('quotes fields containing a comma and doubles embedded quotes', () => {
    const contact: ExportableContact = {
      name: 'Silva, João "JJ"',
      phone: '5583996507373',
      created_at: '2026-08-07T12:00:00Z',
    };
    const csv = contactsToCsv([contact]);
    const [, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(row).toContain('"Silva, João ""JJ"""');
  });

  it('leaves optional fields blank instead of "undefined"', () => {
    const contact: ExportableContact = {
      phone: '5583996507373',
      created_at: '2026-08-07T12:00:00Z',
    };
    const csv = contactsToCsv([contact]);
    const [, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(row).toBe(',5583996507373,,,,2026-08-07');
  });

  it('formats CriadoEm as an ISO date (YYYY-MM-DD)', () => {
    const contact: ExportableContact = {
      phone: '5583996507373',
      created_at: '2026-08-07T23:59:59Z',
    };
    const csv = contactsToCsv([contact]);
    const [, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(row.endsWith(',2026-08-07')).toBe(true);
  });
});
