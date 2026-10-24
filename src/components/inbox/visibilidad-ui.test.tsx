import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../messages/es.json';
import { SinAcceso } from './sin-acceso';
import { FiltroAsesor } from './filtro-asesor';

function render(ui: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  );
}

const asesores = [
  { userId: 'A1', nombre: 'Ana' },
  { userId: 'A2', nombre: 'Beto' },
];

describe('SinAcceso', () => {
  it('muestra el aviso y el botón de volver', () => {
    const html = render(<SinAcceso onVolver={() => {}} />);
    expect(html).toContain('Sin acceso');
    expect(html).toContain('Volver a la bandeja');
  });
});

describe('FiltroAsesor', () => {
  it('ofrece Todos, Sin asignar y cada asesor', () => {
    const html = render(
      <FiltroAsesor
        valor={{ tipo: 'todos' }}
        asesores={asesores}
        onCambio={() => {}}
      />
    );
    for (const t of ['Todos', 'Sin asignar', 'Ana', 'Beto']) {
      expect(html).toContain(t);
    }
  });

  it('marca el asesor elegido', () => {
    const html = render(
      <FiltroAsesor
        valor={{ tipo: 'asesor', asesorId: 'A2' }}
        asesores={asesores}
        onCambio={() => {}}
      />
    );
    expect(html).toMatch(/<option[^>]*value="asesor:A2"[^>]*selected/);
  });
});
