import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowsInviteSignup,
  allowsSelfServeSignup,
  DEFAULT_SIGNUP_MODE,
  getSignupMode,
  parseSignupMode,
} from "./signup-mode";

describe("parseSignupMode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to open when unset", () => {
    expect(parseSignupMode(undefined)).toBe(DEFAULT_SIGNUP_MODE);
    expect(parseSignupMode(null)).toBe("open");
    expect(parseSignupMode("")).toBe("open");
    expect(parseSignupMode("   ")).toBe("open");
  });

  it("accepts the canonical values", () => {
    expect(parseSignupMode("open")).toBe("open");
    expect(parseSignupMode("invite_only")).toBe("invite_only");
    expect(parseSignupMode("disabled")).toBe("disabled");
  });

  it("is case- and separator-insensitive", () => {
    expect(parseSignupMode("  OPEN ")).toBe("open");
    expect(parseSignupMode("Invite-Only")).toBe("invite_only");
    expect(parseSignupMode("INVITE ONLY")).toBe("invite_only");
    expect(parseSignupMode("Disabled")).toBe("disabled");
  });

  it("accepts boolean-ish spellings operators reach for", () => {
    expect(parseSignupMode("true")).toBe("open");
    expect(parseSignupMode("false")).toBe("disabled");
    expect(parseSignupMode("off")).toBe("disabled");
    expect(parseSignupMode("no")).toBe("disabled");
  });

  it("fails closed on an unrecognised value, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseSignupMode("invite-onlyy")).toBe("disabled");
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("getSignupMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads SIGNUP_MODE from the environment", () => {
    vi.stubEnv("SIGNUP_MODE", "invite_only");
    expect(getSignupMode()).toBe("invite_only");
  });

  it("is open when the variable is absent", () => {
    vi.stubEnv("SIGNUP_MODE", "");
    expect(getSignupMode()).toBe("open");
  });
});

describe("capability predicates", () => {
  it("only 'open' permits self-serve signup", () => {
    expect(allowsSelfServeSignup("open")).toBe(true);
    expect(allowsSelfServeSignup("invite_only")).toBe(false);
    expect(allowsSelfServeSignup("disabled")).toBe(false);
  });

  it("everything but 'disabled' permits invited signup", () => {
    expect(allowsInviteSignup("open")).toBe(true);
    expect(allowsInviteSignup("invite_only")).toBe(true);
    expect(allowsInviteSignup("disabled")).toBe(false);
  });
});
