// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttributeSelect } from './attribute-select'

afterEach(cleanup)

const CATEGORY_OPTIONS = [
  { value: 'legging', label: 'legging' },
  { value: 'pantalona', label: 'pantalona' },
  { value: 'top', label: 'top' },
]

describe('AttributeSelect — category/colour picker', () => {
  it('shows the current value on the trigger, or a placeholder when empty', () => {
    const { getByText, rerender } = render(
      <AttributeSelect kind="category" options={CATEGORY_OPTIONS} value={null} onChange={vi.fn()} />,
    )
    expect(getByText('Categoria')).toBeTruthy()

    rerender(<AttributeSelect kind="category" options={CATEGORY_OPTIONS} value="legging" onChange={vi.fn()} />)
    expect(getByText('legging')).toBeTruthy()
  })

  it('opens on click and lists every configured option for this account', async () => {
    const user = userEvent.setup()
    const { getByRole, findByText } = render(
      <AttributeSelect kind="category" options={CATEGORY_OPTIONS} value={null} onChange={vi.fn()} />,
    )

    await user.click(getByRole('button'))

    expect(await findByText('legging')).toBeTruthy()
    expect(await findByText('pantalona')).toBeTruthy()
    expect(await findByText('top')).toBeTruthy()
  })

  it('filters the list as the admin types', async () => {
    const user = userEvent.setup()
    const { getByRole, findByPlaceholderText, queryByText, findByText } = render(
      <AttributeSelect kind="category" options={CATEGORY_OPTIONS} value={null} onChange={vi.fn()} />,
    )

    await user.click(getByRole('button'))
    const search = await findByPlaceholderText('Procurar...')
    await user.type(search, 'pant')

    expect(await findByText('pantalona')).toBeTruthy()
    expect(queryByText('legging')).toBeNull()
  })

  it('calls onChange with the picked canonical value and closes the popover', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByRole, findByText, queryByText } = render(
      <AttributeSelect kind="category" options={CATEGORY_OPTIONS} value={null} onChange={onChange} />,
    )

    await user.click(getByRole('button'))
    await user.click(await findByText('pantalona'))

    expect(onChange).toHaveBeenCalledWith('pantalona')
    expect(queryByText('legging')).toBeNull()
  })

  it('offers "+ Criar" only when onCreate is provided and the typed value matches nothing existing', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue('SUV')
    const { getByRole, findByPlaceholderText, findByText, queryByText } = render(
      <AttributeSelect kind="category" options={CATEGORY_OPTIONS} value={null} onChange={vi.fn()} onCreate={onCreate} />,
    )

    await user.click(getByRole('button'))
    const search = await findByPlaceholderText('Procurar...')
    await user.type(search, 'SUV')

    expect(await findByText('Criar "SUV"')).toBeTruthy()

    // Exact match against an existing option hides the create action.
    await user.clear(search)
    await user.type(search, 'legging')
    expect(queryByText(/Criar/)).toBeNull()
  })

  it('creates a new term and selects it immediately when "+ Criar" is used', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onCreate = vi.fn().mockResolvedValue('SUV')
    const { getByRole, findByPlaceholderText, findByText } = render(
      <AttributeSelect kind="category" options={[]} value={null} onChange={onChange} onCreate={onCreate} />,
    )

    await user.click(getByRole('button'))
    const search = await findByPlaceholderText('Procurar...')
    await user.type(search, 'SUV')
    await user.click(await findByText('Criar "SUV"'))

    expect(onCreate).toHaveBeenCalledWith('SUV')
    expect(onChange).toHaveBeenCalledWith('SUV')
  })
})
