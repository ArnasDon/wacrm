// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// PasswordForm — AUTH-N2 fix. Never had a test file before.
//
// Proves exactly the part of AUTH-N2 that belongs to this project's
// own code: re-authentication must be keyed on the REAL, current
// Supabase Auth email (supabase.auth.getUser()), never on
// `profiles.email` (which this component no longer even reads —
// confirmed by the fact that no `useAuth`/profile mock is set up
// here at all, and the component still works). Nothing here asserts
// or assumes internal Supabase Auth behavior (e.g. whether
// updateUser({email}) requires double confirmation) that this
// repository can't verify.
// ============================================================

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      updateUser: mocks.updateUser,
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

// Same convention as ai-config.test.tsx — a stable translate function
// that just echoes the key (plus vars, if any) rather than a real
// dictionary.
const translate = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key
vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}))

import { PasswordForm } from './password-form'

function fillAndSubmit(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('currentPassword'), {
    target: { value: current },
  })
  fireEvent.change(screen.getByLabelText('newPassword'), {
    target: { value: next },
  })
  fireEvent.change(screen.getByLabelText('confirmPassword'), {
    target: { value: confirm },
  })
  fireEvent.click(screen.getByRole('button', { name: 'updatePassword' }))
}

beforeEach(() => {
  mocks.getUser.mockReset()
  mocks.signInWithPassword.mockReset()
  mocks.updateUser.mockReset()
  mocks.toastError.mockReset()
  mocks.toastSuccess.mockReset()
})

afterEach(() => cleanup())

describe('PasswordForm — AUTH-N2 (re-authenticate against the real current email)', () => {
  it('resolves the email via getUser() and uses it for signInWithPassword — never a prop/stale value', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'current-real-email@example.com' } },
      error: null,
    })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.updateUser.mockResolvedValue({ error: null })

    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'new-password-123', 'new-password-123')

    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalled())
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'current-real-email@example.com',
      password: 'correct-current-pw',
    })
  })

  it('no regression: a full successful run still calls updateUser and shows the success toast', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'user@example.com' } },
      error: null,
    })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.updateUser.mockResolvedValue({ error: null })

    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'new-password-123', 'new-password-123')

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({
        password: 'new-password-123',
        current_password: 'correct-current-pw',
      }),
    )
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('passwordUpdated'))
  })

  // AUTH-N4: Supabase's own "Require current password when updating"
  // check is enforced server-side on the `current_password` field of
  // this same updateUser call — signInWithPassword above only ever
  // protected the app's own UI. Asserted as its own test (distinct
  // current/new values) so a regression that swaps the two fields, or
  // drops current_password silently, fails here even if the
  // "no regression" test above happened to use the same string twice.
  it('AUTH-N4: current_password sent to updateUser matches exactly what was typed as the current password', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'user@example.com' } },
      error: null,
    })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.updateUser.mockResolvedValue({ error: null })

    render(<PasswordForm />)
    fillAndSubmit('this-is-the-old-one', 'this-is-the-new-one', 'this-is-the-new-one')

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalled())
    const call = mocks.updateUser.mock.calls[0][0]
    expect(call.current_password).toBe('this-is-the-old-one')
    expect(call.password).toBe('this-is-the-new-one')
    // Never accidentally the same value, and never mixed up.
    expect(call.current_password).not.toBe(call.password)
  })

  it('getUser() returning no user blocks the operation safely — signInWithPassword is never called', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'new-password-123', 'new-password-123')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('cannotChangeNoEmail'))
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('getUser() returning an error blocks the operation safely', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'network unreachable' },
    })

    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'new-password-123', 'new-password-123')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('cannotChangeNoEmail'))
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('a user object with no email is treated the same as no session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: null } }, error: null })

    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'new-password-123', 'new-password-123')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('cannotChangeNoEmail'))
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('wrong current password: signInWithPassword fails, updateUser is never reached', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'user@example.com' } },
      error: null,
    })
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })

    render(<PasswordForm />)
    fillAndSubmit('wrong-current-pw', 'new-password-123', 'new-password-123')

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('currentPasswordIncorrect'),
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('a too-short new password is rejected client-side — getUser/Supabase are never called', async () => {
    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'short', 'short')

    expect(await screen.findByText(/passwordTooShort/)).toBeTruthy()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('mismatched new/confirm passwords are rejected client-side — getUser/Supabase are never called', async () => {
    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'new-password-123', 'does-not-match-456')

    expect(await screen.findByText('passwordMismatch')).toBeTruthy()
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  // AUTH-N5: a server-side rejection (e.g. Supabase's "Password
  // requirements" complexity check) must still reach the user. This
  // component has no client-side character-class validation of its
  // own — an 8+ character password that fails Supabase's policy
  // relies entirely on the existing `passwordUpdateFailed` error path.
  // Does not assert any specific real Supabase error string, only
  // that whatever `error.message` comes back is surfaced.
  it('AUTH-N5: a password-policy rejection from Supabase on updateUser is shown to the user', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: 'user@example.com' } },
      error: null,
    })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.updateUser.mockResolvedValue({
      error: { message: 'Password should contain at least one letter and one digit' },
    })

    render(<PasswordForm />)
    fillAndSubmit('correct-current-pw', 'onlyletters', 'onlyletters')

    // The mocked translate() echoes `key:JSON(vars)` as a single
    // string (see the top of this file) — toast.error is called with
    // that one already-interpolated string, same as every other
    // toast.error assertion in this file.
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        `passwordUpdateFailed:${JSON.stringify({
          message: 'Password should contain at least one letter and one digit',
        })}`,
      ),
    )
  })
})
