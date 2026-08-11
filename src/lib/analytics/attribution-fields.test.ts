import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTION_FIELDS,
  attributionFieldValues,
} from './attribution-fields';

describe('attributionFieldValues', () => {
  it('proyecta los UTM y el canal', () => {
    expect(
      attributionFieldValues({
        channel: 'google',
        utm: { source: 'google', medium: 'cpc', campaign: 'prueba', content: 'anuncio-1', term: 'implantes' },
        landing_slug: '/landing/',
        click_ids: {},
      })
    ).toEqual({
      channel: 'google',
      source: 'google',
      medium: 'cpc',
      campaign: 'prueba',
      content: 'anuncio-1',
      term: 'implantes',
      landing: '/landing/',
    });
  });

  it('guarda el click id como tipo:valor — el tipo dice de qué red vino', () => {
    const out = attributionFieldValues({
      utm: {},
      click_ids: { gclid: 'Cj0KCQ' },
      landing_slug: '/l/',
    });
    expect(out.click_id).toBe('gclid:Cj0KCQ');
  });

  it('un contacto directo no genera campos vacíos', () => {
    // Sin esto la ficha de cada lead orgánico se llenaría de seis filas en
    // blanco, que es peor que no mostrar nada.
    expect(attributionFieldValues({ utm: {}, click_ids: {}, landing_slug: '' })).toEqual({});
  });

  it('el medio del UTM manda sobre el inferido', () => {
    const out = attributionFieldValues({
      utm: { medium: 'cpc' },
      medium: 'organic',
      click_ids: {},
      landing_slug: '',
    });
    expect(out.medium).toBe('cpc');
  });

  it('cae al medio inferido cuando el UTM no lo trae', () => {
    const out = attributionFieldValues({
      utm: {},
      medium: 'organic',
      click_ids: {},
      landing_slug: '',
    });
    expect(out.medium).toBe('organic');
  });

  it('tolera una atribución a medias (lo que llega por la red)', () => {
    // trackEventSchema deja pasar objetos sin utm ni click_ids; si esto
    // reventara, tumbaría la creación del lead.
    expect(() => attributionFieldValues({})).not.toThrow();
    expect(attributionFieldValues({ channel: 'direct' })).toEqual({ channel: 'direct' });
  });

  it('ignora un click id vacío', () => {
    const out = attributionFieldValues({
      utm: {},
      click_ids: { gclid: '', fbclid: 'abc' },
      landing_slug: '',
    });
    expect(out.click_id).toBe('fbclid:abc');
  });

  it('cada clave proyectada tiene su definición de campo', () => {
    const keys = new Set(ATTRIBUTION_FIELDS.map((f) => f.key));
    const out = attributionFieldValues({
      channel: 'x',
      utm: { source: 'a', medium: 'b', campaign: 'c', term: 'd', content: 'e' },
      click_ids: { gclid: 'g' },
      landing_slug: '/l/',
    });
    for (const k of Object.keys(out)) expect(keys.has(k as never)).toBe(true);
    // Los ocho campos se llenan cuando la atribución viene completa.
    expect(Object.keys(out)).toHaveLength(ATTRIBUTION_FIELDS.length);
  });
});
