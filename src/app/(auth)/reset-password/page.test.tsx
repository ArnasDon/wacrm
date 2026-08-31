// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ============================================================
// /reset-password — closes AUTH-N1. Never had a test file before
// (the page never existed).
// ============================================================

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

import ResetPasswordPage from "./page";

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.updateUser.mockReset();
  mocks.replace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// AUTH-N1.10
describe("without a valid session", () => {
  it("never renders the password form and redirects to /login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    render(<ResetPasswordPage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});

// AUTH-N1.9
describe("with a valid session", () => {
  it("renders the form and allows updateUser to run", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.updateUser.mockResolvedValue({ error: null });

    render(<ResetPasswordPage />);

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    fireEvent.change(passwordInput, { target: { value: "correct-horse-battery" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({
        password: "correct-horse-battery",
      }),
    );
    expect(mocks.replace).not.toHaveBeenCalledWith("/login");
  });

  // AUTH-N1.12
  it("shows a success state and finishes by redirecting to the dashboard", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.updateUser.mockResolvedValue({ error: null });

    render(<ResetPasswordPage />);

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    fireEvent.change(passwordInput, { target: { value: "correct-horse-battery" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/password updated/i)).toBeTruthy(),
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  // AUTH-N1.11
  it("a too-short password is rejected client-side, updateUser is never called", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    render(<ResetPasswordPage />);

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    fireEvent.change(passwordInput, { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeTruthy();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("mismatched confirmation is rejected client-side, updateUser is never called", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    render(<ResetPasswordPage />);

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    fireEvent.change(passwordInput, { target: { value: "correct-horse-battery" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "does-not-match" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("an updateUser error is shown and does not advance to the success state", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.updateUser.mockResolvedValue({
      error: { message: "New password should be different from the old password." },
    });

    render(<ResetPasswordPage />);

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    fireEvent.change(passwordInput, { target: { value: "correct-horse-battery" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(
      await screen.findByText(/should be different from the old password/i),
    ).toBeTruthy();
    expect(screen.queryByText(/password updated/i)).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalledWith("/dashboard");
  });

  // AUTH-N1.13
  it("never renders the password value anywhere, and never logs it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.updateUser.mockResolvedValue({ error: null });
    const SECRET_PASSWORD = "correct-horse-battery-staple-123";

    render(<ResetPasswordPage />);
    const passwordInput = await screen.findByLabelText(/^new password$/i);
    fireEvent.change(passwordInput, { target: { value: SECRET_PASSWORD } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: SECRET_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalled());

    for (const spy of [logSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET_PASSWORD);
      }
    }
    expect(document.body.textContent).not.toContain(SECRET_PASSWORD);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
