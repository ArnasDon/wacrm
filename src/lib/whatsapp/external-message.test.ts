import { describe, expect, it } from 'vitest';
import { resolveExternalMessage } from './external-message';

describe('resolveExternalMessage', () => {
  it('substitutes {{nome}} with the contact name', () => {
    expect(resolveExternalMessage('Oi {{nome}}, tudo bem?', { name: 'Pedro' })).toBe(
      'Oi Pedro, tudo bem?',
    );
  });

  it('is case-insensitive and tolerates internal spacing', () => {
    expect(resolveExternalMessage('Oi {{Nome}}!', { name: 'Maria' })).toBe('Oi Maria!');
    expect(resolveExternalMessage('Oi {{ nome }}!', { name: 'Maria' })).toBe('Oi Maria!');
  });

  it('replaces every occurrence', () => {
    expect(resolveExternalMessage('{{nome}}, oi {{nome}}!', { name: 'Ana' })).toBe(
      'Ana, oi Ana!',
    );
  });

  it('removes the placeholder without using the phone when name is missing', () => {
    expect(resolveExternalMessage('Oi {{nome}}!', { name: null, phone: '+5511999999999' })).toBe(
      'Oi!',
    );
  });

  it('removes the placeholder and its leading space when there is no name and no phone', () => {
    expect(resolveExternalMessage('Oi {{nome}}!', {})).toBe('Oi!');
  });

  it('leaves a template with no placeholder untouched', () => {
    expect(resolveExternalMessage('Mensagem sem variavel.', { name: 'Pedro' })).toBe(
      'Mensagem sem variavel.',
    );
  });

  it('treats a whitespace-only name as missing and never falls back to phone', () => {
    expect(resolveExternalMessage('Oi {{nome}}!', { name: '   ', phone: '5511999999999' })).toBe(
      'Oi!',
    );
  });

  it('removes the placeholder without a stray space/comma before the following punctuation', () => {
    expect(resolveExternalMessage('Olá {{nome}}, tudo bem?', {})).toBe('Olá, tudo bem?');
  });
});
