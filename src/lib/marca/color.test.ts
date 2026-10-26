import { describe, expect, it } from 'vitest';
import { esHexColor, tokensDeColor } from './color';

describe('esHexColor', () => {
  it('acepta #rrggbb', () => {
    expect(esHexColor('#2f7bf5')).toBe(true);
    expect(esHexColor('#2F7BF5')).toBe(true);
  });
  it('rechaza todo lo demás', () => {
    for (const v of ['2f7bf5', '#fff', '#gggggg', '#2f7bf5ff', '', 'red'])
      expect(esHexColor(v)).toBe(false);
  });
});

describe('tokensDeColor', () => {
  it('devuelve colores oklch', () => {
    const t = tokensDeColor('#2f7bf5');
    expect(t.primary).toMatch(/^oklch\(/);
    expect(t.hover).toMatch(/^oklch\(/);
    expect(t.soft).toMatch(/\/ 0\.12\)$/);
    expect(t.soft2).toMatch(/\/ 0\.2\)$/);
  });
  it('texto claro sobre un color oscuro', () => {
    expect(tokensDeColor('#1d4ed8').primaryForeground).toBe('oklch(0.985 0 0)');
  });
  it('texto oscuro sobre un color muy claro', () => {
    expect(tokensDeColor('#ffffcc').primaryForeground).not.toBe(
      'oklch(0.985 0 0)'
    );
  });
});
