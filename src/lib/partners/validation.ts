// ============================================================
// Partner invitation / signup input validation — pure and shared.
//
// Imported by both the Create Partner dialog and the signup page
// (client-side feedback) and by the API routes (the authoritative
// check). Errors are returned as stable codes so the client can
// translate them and the server can map them to messages.
// ============================================================

import { parseInternationalPhone } from "@/lib/whatsapp/phone-utils";

export const MAX_COMPANY_NAME_LEN = 120;
export const MAX_PERSON_NAME_LEN = 60;
export const MAX_EMAIL_LEN = 254;
export const MIN_PASSWORD_LEN = 8;
/** bcrypt only hashes the first 72 bytes; reject longer input outright. */
export const MAX_PASSWORD_LEN = 72;

// Pragmatic address check: one @, no whitespace, a dotted domain.
// RFC 5322 is looser, but this matches what Supabase Auth accepts and
// rejects the common typos ("john@example", "john example.com").
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type FieldError =
  | "required"
  | "tooLong"
  | "invalidEmail"
  | "invalidPhone"
  | "tooShort"
  | "mismatch";

export type ValidationResult<T, F extends string> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<F, FieldError>> };

export interface PartnerInviteInput {
  companyName: string;
  email: string;
  /** Normalised to "+<digits>". */
  phone: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

/**
 * Validate the Create Partner form. Phone numbers must be international
 * (leading "+"), same rule the rest of the app applies to typed numbers
 * (see `parseInternationalPhone`).
 */
export function validatePartnerInvite(
  raw: unknown,
): ValidationResult<PartnerInviteInput, keyof PartnerInviteInput> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<keyof PartnerInviteInput, FieldError>> = {};

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  if (!companyName) errors.companyName = "required";
  else if (companyName.length > MAX_COMPANY_NAME_LEN) errors.companyName = "tooLong";

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!email) errors.email = "required";
  else if (!isValidEmail(email)) errors.email = "invalidEmail";

  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
  const phoneDigits = phoneRaw ? parseInternationalPhone(phoneRaw) : null;
  if (!phoneRaw) errors.phone = "required";
  else if (!phoneDigits) errors.phone = "invalidPhone";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { companyName, email, phone: `+${phoneDigits}` } };
}

export interface PartnerSignupInput {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword?: string;
}

/**
 * Validate the partner signup form. `confirmPassword` is checked when
 * present (the page always sends it; API clients may omit it).
 */
export function validatePartnerSignup(
  raw: unknown,
): ValidationResult<PartnerSignupInput, keyof PartnerSignupInput> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<keyof PartnerSignupInput, FieldError>> = {};

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  if (!firstName) errors.firstName = "required";
  else if (firstName.length > MAX_PERSON_NAME_LEN) errors.firstName = "tooLong";

  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  if (!lastName) errors.lastName = "required";
  else if (lastName.length > MAX_PERSON_NAME_LEN) errors.lastName = "tooLong";

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) errors.password = "required";
  else if (password.length < MIN_PASSWORD_LEN) errors.password = "tooShort";
  else if (password.length > MAX_PASSWORD_LEN) errors.password = "tooLong";

  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : undefined;
  if (confirmPassword !== undefined && confirmPassword !== password) {
    errors.confirmPassword = "mismatch";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { firstName, lastName, password, confirmPassword } };
}

/** Human-readable English message for API responses. */
export function describeFieldError(field: string, code: FieldError): string {
  const label: Record<string, string> = {
    companyName: "Company name",
    email: "Email",
    phone: "Phone number",
    firstName: "First name",
    lastName: "Last name",
    password: "Password",
    confirmPassword: "Confirm password",
  };
  const name = label[field] ?? field;
  switch (code) {
    case "required":
      return `${name} is required`;
    case "tooLong":
      return `${name} is too long`;
    case "invalidEmail":
      return "Enter a valid email address";
    case "invalidPhone":
      return "Enter the phone number in international format, e.g. +14155550123";
    case "tooShort":
      return `Password must be at least ${MIN_PASSWORD_LEN} characters`;
    case "mismatch":
      return "Passwords do not match";
  }
}
