import { describe, it, expect } from 'vitest'
import {
  flattenMenuOptions,
  appendNumberedOptions,
  renderMenuForChannel,
} from './channel-render'

const buttonsNode = {
  node_type: 'send_buttons',
  config: {
    text: '¿Con qué te ayudamos?',
    buttons: [
      { reply_id: 'cotizar', title: 'Cotizar servicios', next_node_key: 'a' },
      { reply_id: 'soporte', title: 'Ya soy cliente', next_node_key: 'b' },
    ],
  },
}

const listNode = {
  node_type: 'send_list',
  config: {
    text: 'Elige una opción',
    button_label: 'Ver opciones',
    sections: [
      { title: 'A', rows: [{ reply_id: 'r1', title: 'Uno', next_node_key: 'a' }] },
      {
        title: 'B',
        rows: [
          { reply_id: 'r2', title: 'Dos', next_node_key: 'b' },
          { reply_id: 'r3', title: 'Tres', next_node_key: 'c' },
        ],
      },
    ],
  },
}

describe('flattenMenuOptions', () => {
  it('reads send_buttons in order', () => {
    expect(flattenMenuOptions(buttonsNode)).toEqual([
      { title: 'Cotizar servicios', reply_id: 'cotizar' },
      { title: 'Ya soy cliente', reply_id: 'soporte' },
    ])
  })

  it('flattens send_list rows across sections in display order', () => {
    expect(flattenMenuOptions(listNode).map((o) => o.title)).toEqual([
      'Uno',
      'Dos',
      'Tres',
    ])
  })

  it('returns [] for a node with no options', () => {
    expect(
      flattenMenuOptions({ node_type: 'send_message', config: { text: 'hi' } }),
    ).toEqual([])
    expect(flattenMenuOptions({ node_type: 'send_buttons', config: {} })).toEqual(
      [],
    )
  })
})

describe('appendNumberedOptions', () => {
  it('appends a 1-based numbered list', () => {
    expect(
      appendNumberedOptions('Hola', [{ title: 'A' }, { title: 'B' }]),
    ).toBe('Hola\n\n1. A\n2. B')
  })

  it('is a no-op with no options', () => {
    expect(appendNumberedOptions('Hola', [])).toBe('Hola')
  })

  it('drops the leading blank lines when the body is empty', () => {
    expect(appendNumberedOptions('', [{ title: 'A' }])).toBe('1. A')
  })
})

describe('renderMenuForChannel', () => {
  it('whatsapp: native buttons, clean body', () => {
    const r = renderMenuForChannel(buttonsNode, 'whatsapp')
    expect(r.presentation).toBe('native_buttons')
    expect(r.body).toBe('¿Con qué te ayudamos?')
    expect(r.options).toHaveLength(2)
  })

  it('whatsapp: send_list → native_list, carries the button label', () => {
    const r = renderMenuForChannel(listNode, 'whatsapp')
    expect(r.presentation).toBe('native_list')
    expect(r.buttonLabel).toBe('Ver opciones')
  })

  it('meta: chips + numbered body', () => {
    const r = renderMenuForChannel(buttonsNode, 'meta')
    expect(r.presentation).toBe('quick_reply_chips')
    expect(r.body).toBe(
      '¿Con qué te ayudamos?\n\n1. Cotizar servicios\n2. Ya soy cliente',
    )
  })
})
