// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DestructiveConfirmDialog } from './destructive-confirm-dialog'

// ============================================================
// AI Agents Setup — destructive-action confirmation security fix.
//
// This is the ONE component every "Eliminar" button in the AI Agents
// Setup screen (agent config, knowledge-base documents, data sources,
// catalog integrations) is wired through, so its safety guarantees are
// tested exhaustively HERE rather than duplicated per call site:
//
//   - the trigger that OPENS this dialog never itself deletes anything
//     (proven at the call-site level, in each settings component's own
//     test — this file proves what happens once the dialog is open);
//   - Cancel never calls the destructive action;
//   - a double click on Confirm can only ever fire the action once;
//   - a failed action keeps the dialog open and shows the error,
//     rather than pretending it succeeded;
//   - a `critical` (double-confirmation) flow never runs the
//     destructive action on the first screen — only the second.
// ============================================================

afterEach(() => {
  cleanup()
})

function baseProps(overrides: Partial<React.ComponentProps<typeof DestructiveConfirmDialog>> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete this thing?',
    description: 'This cannot be undone.',
    cancelLabel: 'Cancel',
    confirmLabel: 'Delete',
    onConfirm: vi.fn().mockResolvedValue(undefined),
    errorFallback: 'Something went wrong.',
    ...overrides,
  }
}

describe('DestructiveConfirmDialog — simple (single-step) flow', () => {
  it('renders nothing destructive-yet when open — onConfirm has not been called just by opening', () => {
    const props = baseProps()
    render(<DestructiveConfirmDialog {...props} />)
    expect(props.onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this thing?')).toBeTruthy()
  })

  it('Cancel closes the dialog and NEVER calls onConfirm (TEST 3 / 9)', () => {
    const props = baseProps()
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(props.onConfirm).not.toHaveBeenCalled()
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('clicking Confirm calls onConfirm exactly once and then closes (TEST 4)', async () => {
    const props = baseProps()
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('a double click on Confirm only ever runs the destructive action once (TEST 5)', async () => {
    let resolveConfirm: () => void = () => {}
    const slow = vi.fn(
      () => new Promise<void>((resolve) => { resolveConfirm = resolve }),
    )
    const props = baseProps({ onConfirm: slow })
    render(<DestructiveConfirmDialog {...props} />)
    const button = screen.getByText('Delete')
    fireEvent.click(button)
    fireEvent.click(button) // fired again before the first call resolved
    resolveConfirm()
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1))
  })

  it('a failed delete keeps the dialog open and shows the error — never pretends success (TEST 6 / 10)', async () => {
    const props = baseProps({
      onConfirm: vi.fn().mockRejectedValue(new Error('Server refused the request.')),
    })
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(screen.getByText('Server refused the request.')).toBeTruthy())
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('a rejection with no message falls back to errorFallback', async () => {
    const props = baseProps({ onConfirm: vi.fn().mockRejectedValue(new Error('')) })
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(screen.getByText('Something went wrong.')).toBeTruthy())
  })

  it('a successful delete resets submitting so a later reuse of the same dialog is not stuck spinning', async () => {
    const props = baseProps()
    const { rerender } = render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))

    rerender(<DestructiveConfirmDialog {...props} open={false} />)
    rerender(<DestructiveConfirmDialog {...props} open={true} />)
    const button = screen.getByText('Delete').closest('button')
    expect(button?.disabled).toBe(false)
  })

  it('open=false renders no dialog content (closed modal deletes nothing — TEST 9)', () => {
    const props = baseProps({ open: false })
    render(<DestructiveConfirmDialog {...props} />)
    expect(screen.queryByText('Delete this thing?')).toBeNull()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})

describe('DestructiveConfirmDialog — critical (double-confirmation) flow', () => {
  function criticalProps(overrides: Partial<React.ComponentProps<typeof DestructiveConfirmDialog>> = {}) {
    return baseProps({
      confirmLabel: 'Continue',
      critical: {
        title: 'Confirm permanent removal',
        description: 'This deletes the API key too.',
        confirmLabel: 'Delete permanently',
      },
      ...overrides,
    })
  }

  it('the FIRST screen\'s button only advances to the second screen — never calls onConfirm (TEST 7 / core rule)', () => {
    const props = criticalProps()
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Continue'))
    expect(props.onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Confirm permanent removal')).toBeTruthy()
    expect(screen.getByText('This deletes the API key too.')).toBeTruthy()
  })

  it('only the SECOND screen\'s confirm button actually runs the destructive action', async () => {
    const props = criticalProps()
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Continue'))
    fireEvent.click(screen.getByText('Delete permanently'))
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1))
  })

  it('Cancel on the second screen still never calls onConfirm', () => {
    const props = criticalProps()
    render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Continue'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('reopening after a Cancel resets back to the first screen (no stale step leaks across opens)', () => {
    // Mirrors real usage: every call site's `open` prop only ever
    // flips to false as a RESULT of this dialog's own Cancel/backdrop/
    // successful-confirm handling (never set independently by the
    // parent), so a fresh open always follows one of those closes.
    const props = criticalProps()
    const { rerender } = render(<DestructiveConfirmDialog {...props} />)
    fireEvent.click(screen.getByText('Continue'))
    expect(screen.getByText('Confirm permanent removal')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))
    rerender(<DestructiveConfirmDialog {...props} open={false} />)
    rerender(<DestructiveConfirmDialog {...props} open={true} />)
    expect(screen.getByText('Delete this thing?')).toBeTruthy()
    expect(screen.queryByText('Confirm permanent removal')).toBeNull()
  })
})
