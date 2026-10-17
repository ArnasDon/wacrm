// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ============================================================
// /signup — AUTH-N5. Never had a test file before this project (the
// signup password check was hardcoded at 6 with no coverage at all).
// Covers the client-side password-length floor (shared MIN_PASSWORD,
// now 8 — same constant as password-form.tsx and reset-password/
// page.tsx) and confirms the rest of the signup flow (confirm-password
// mismatch, successful signUp) keeps working exactly as before.
// ============================================================

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signUp: mocks.signUp },
  }),
}));

// signup/page.tsx reads an optional `?invite=` query param via
// useSearchParams — no test here exercises the invite-token branch
// (that's the /join flow's own concern), so a fixed empty
// URLSearchParams is enough to let the component render.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

import SignupPage from "./page";

function fillAndSubmit(
  fullName: string,
  email: string,
  password: string,
  confirmPassword: string,
) {
  fireEvent.change(screen.getByLabelText("Full name"), {
    target: { value: fullName },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: confirmPassword },
  });
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
}

beforeEach(() => {
  mocks.signUp.mockReset();
});

afterEach(() => cleanup());

describe("SignupPage — AUTH-N5 (shared 8-character minimum)", () => {
  it("a 7-character password is rejected client-side, signUp is never called", async () => {
    render(<SignupPage />);
    fillAndSubmit("Ada Lovelace", "ada@example.com", "1234567", "1234567");

    expect(await screen.findByText(/at least 8 characters/i)).toBeTruthy();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("an 8-character password passes the length check and signUp proceeds", async () => {
    mocks.signUp.mockResolvedValue({ error: null });
    render(<SignupPage />);
    fillAndSubmit("Ada Lovelace", "ada@example.com", "12345678", "12345678");

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled());
    const call = mocks.signUp.mock.calls[0][0] as { password: string };
    expect(call.password).toBe("12345678");
  });

  it('no regression: a full successful signup still shows the "check your email" confirmation', async () => {
    mocks.signUp.mockResolvedValue({ error: null });
    render(<SignupPage />);
    fillAndSubmit("Ada Lovelace", "ada@example.com", "12345678", "12345678");

    expect(await screen.findByText("Check your email")).toBeTruthy();
  });

  it("mismatched confirmation is still rejected client-side, signUp is never called", async () => {
    render(<SignupPage />);
    fillAndSubmit("Ada Lovelace", "ada@example.com", "12345678", "does-not-match");

    expect(await screen.findByText(/passwords do not match/i)).toBeTruthy();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  // AUTH-N5: a server-side rejection (e.g. Supabase's own "Password
  // requirements" complexity check, now letters+digits) must still
  // reach the user — this app has no client-side character-class
  // validation of its own, so an 8+ character password that fails
  // Supabase's policy relies entirely on the existing generic error
  // handling already in this component. This does not assert any
  // specific real Supabase error string — only that whatever message
  // comes back in `error.message` is shown, same as any other signUp
  // failure this component already handled before AUTH-N5.
  it("a password-policy rejection from Supabase is shown to the user", async () => {
    mocks.signUp.mockResolvedValue({
      error: { message: "Password should contain at least one letter and one digit" },
    });
    render(<SignupPage />);
    fillAndSubmit("Ada Lovelace", "ada@example.com", "onlyletters", "onlyletters");

    expect(
      await screen.findByText(/password should contain at least one letter/i),
    ).toBeTruthy();
  });
});
