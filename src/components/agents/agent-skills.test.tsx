// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/hooks/use-can', () => ({ useCan: () => true }))

import { AgentSkills } from './agent-skills'

afterEach(cleanup)

const SKILL = {
  id: 'skill-1',
  name: 'Vendas & Descoberta',
  instructions: 'Ajuda o cliente a escolher.',
  objective: 'Ajuda clientes a descobrir e comprar produtos.',
  when_to_use: '',
  when_not_to_use: '',
  tool_keys: ['search_catalog', 'send_product', 'search_knowledge', 'add_tag'],
  enabled: true,
  sort_order: 0,
}

function mockFetchSequence(...responses: Array<{ ok?: boolean; body: unknown }>) {
  const fn = vi.fn()
  for (const { ok = true, body } of responses) {
    fn.mockImplementationOnce(async () => ({ ok, json: async () => body }))
  }
  return fn
}

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true))
})

describe('AgentSkills — collapsed by default, expand to edit', () => {
  it('loads skills collapsed: shows the summary card, not the full form', async () => {
    global.fetch = mockFetchSequence({ body: { configured: true, skills: [SKILL] } })

    const { findByText, queryByText } = render(<AgentSkills />)

    expect(await findByText('Vendas & Descoberta')).toBeTruthy()
    expect(await findByText('ACTIVA')).toBeTruthy()
    expect(await findByText('4 ferramentas')).toBeTruthy()
    expect(queryByText('Instruções')).toBeNull()
  })

  it('clicking a skill expands its edit form', async () => {
    global.fetch = mockFetchSequence({ body: { configured: true, skills: [SKILL] } })
    const user = userEvent.setup()

    const { findByText, getByDisplayValue } = render(<AgentSkills />)
    await user.click(await findByText('Vendas & Descoberta'))

    expect(getByDisplayValue('Vendas & Descoberta')).toBeTruthy()
    expect(getByDisplayValue('Ajuda o cliente a escolher.')).toBeTruthy()
  })

  it('Cancelar discards edits without calling the API and collapses back', async () => {
    global.fetch = mockFetchSequence({ body: { configured: true, skills: [SKILL] } })
    const user = userEvent.setup()

    const { findByText, getByText, getByDisplayValue, queryByDisplayValue } = render(<AgentSkills />)
    await user.click(await findByText('Vendas & Descoberta'))
    const nameInput = getByDisplayValue('Vendas & Descoberta')
    await user.clear(nameInput)
    await user.type(nameInput, 'Nome alterado')

    await user.click(getByText('Cancelar'))

    expect(global.fetch).toHaveBeenCalledTimes(1) // only the initial GET — no PATCH fired
    expect(queryByDisplayValue('Nome alterado')).toBeNull()
    expect(getByText('Vendas & Descoberta')).toBeTruthy()
  })

  it('Guardar alterações saves via PATCH and collapses back to the updated summary', async () => {
    const updated = { ...SKILL, name: 'Vendas Renovadas' }
    global.fetch = mockFetchSequence(
      { body: { configured: true, skills: [SKILL] } },
      { body: { skill: updated } },
    )
    const user = userEvent.setup()

    const { findByText, getByDisplayValue, getByText, queryByDisplayValue } = render(<AgentSkills />)
    await user.click(await findByText('Vendas & Descoberta'))
    const nameInput = getByDisplayValue('Vendas & Descoberta')
    await user.clear(nameInput)
    await user.type(nameInput, 'Vendas Renovadas')
    await user.click(getByText('Guardar alterações'))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    const [, patchCall] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(patchCall[0]).toBe('/api/ai/skills/skill-1')
    expect(patchCall[1].method).toBe('PATCH')

    await waitFor(() => expect(queryByDisplayValue('Vendas Renovadas')).toBeNull())
    expect(getByText('Vendas Renovadas')).toBeTruthy()
  })
})
