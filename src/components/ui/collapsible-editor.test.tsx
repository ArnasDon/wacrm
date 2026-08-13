// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleEditor } from './collapsible-editor'

afterEach(cleanup)

/** A minimal stand-in for how Skills/Tools/taxonomy rows actually drive this component. */
function Harness({ onSave }: { onSave: (value: string) => Promise<void> | void }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState('original')
  const [draft, setDraft] = useState(saved)

  return (
    <CollapsibleEditor
      editing={editing}
      onToggle={() => {
        if (!editing) setDraft(saved)
        setEditing((current) => !current)
      }}
      onCancel={() => setEditing(false)}
      onSave={async () => {
        await onSave(draft)
        setSaved(draft)
        setEditing(false)
      }}
      header={<p>Resumo: {saved}</p>}
    >
      <input aria-label="campo" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </CollapsibleEditor>
  )
}

describe('CollapsibleEditor — view mode / edit mode', () => {
  it('starts collapsed: shows the summary, not the edit form', () => {
    const { getByText, queryByLabelText } = render(<Harness onSave={vi.fn()} />)

    expect(getByText('Resumo: original')).toBeTruthy()
    expect(queryByLabelText('campo')).toBeNull()
  })

  it('clicking the header expands the edit form', async () => {
    const user = userEvent.setup()
    const { getByText, getByLabelText } = render(<Harness onSave={vi.fn()} />)

    await user.click(getByText('Resumo: original'))

    expect(getByLabelText('campo')).toBeTruthy()
  })

  it('Cancelar discards the edit and collapses without persisting', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    const { getByText, getByLabelText, getByRole, queryByLabelText } = render(<Harness onSave={onSave} />)

    await user.click(getByText('Resumo: original'))
    await user.clear(getByLabelText('campo'))
    await user.type(getByLabelText('campo'), 'alterado')
    await user.click(getByRole('button', { name: 'Cancelar' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(getByText('Resumo: original')).toBeTruthy()
    expect(queryByLabelText('campo')).toBeNull()
  })

  it('Guardar persists and collapses back to an updated summary automatically', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    const { getByText, getByLabelText, getByRole, queryByLabelText } = render(<Harness onSave={onSave} />)

    await user.click(getByText('Resumo: original'))
    await user.clear(getByLabelText('campo'))
    await user.type(getByLabelText('campo'), 'novo valor')
    await user.click(getByRole('button', { name: 'Guardar alterações' }))

    expect(onSave).toHaveBeenCalledWith('novo valor')
    expect(getByText('Resumo: novo valor')).toBeTruthy()
    expect(queryByLabelText('campo')).toBeNull()
  })

  it('does not expand when canEdit is false', async () => {
    const user = userEvent.setup()
    const { getByText, queryByLabelText } = render(
      <CollapsibleEditor editing={false} canEdit={false} onToggle={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()} header={<p>Só leitura</p>}>
        <input aria-label="campo" />
      </CollapsibleEditor>,
    )

    await user.click(getByText('Só leitura'))
    expect(queryByLabelText('campo')).toBeNull()
  })
})
