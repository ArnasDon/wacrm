import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AsesorSoloLectura } from './asesor-solo-lectura';

describe('AsesorSoloLectura', () => {
  it('muestra el asesor sin menú', () => {
    const html = renderToStaticMarkup(<AsesorSoloLectura etiqueta="Ana" />);
    expect(html).toContain('Ana');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('<button');
  });
});
