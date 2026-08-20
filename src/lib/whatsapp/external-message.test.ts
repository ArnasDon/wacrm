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

  it('falls back to phone when name is missing', () => {
    expect(resolveExternalMessage('Oi {{nome}}!', { name: null, phone: '+5511999999999' })).toBe(
      'Oi +5511999999999!',
    );
  });

  it('falls back to empty string when neither name nor phone is available', () => {
    expect(resolveExternalMessage('Oi {{nome}}!', {})).toBe('Oi !');
  });

  it('leaves a template with no placeholder untouched', () => {
    expect(resolveExternalMessage('Mensagem sem variavel.', { name: 'Pedro' })).toBe(
      'Mensagem sem variavel.',
    );
  });

  it('trims whitespace-only names before falling back', () => {
    expect(resolveExternalMessage('Oi {{nome}}!', { name: '   ', phone: '5511999999999' })).toBe(
      'Oi 5511999999999!',
    );
  });
});
