import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSecretSidecarsForTests,
  consumeSecretSidecar,
  createSecretSidecar,
} from "./flow-code-sidecars";

beforeEach(clearSecretSidecarsForTests);

describe("flow code secret sidecars", () => {
  it("is actor/account-bound, one-time and expires in memory", () => {
    const token = createSecretSidecar({
      actorId: "actor-1",
      accountId: "account-1",
      bindings: { "request.headers.authorization": "Bearer private" },
      now: 1_000,
    });

    expect(
      consumeSecretSidecar({
        token,
        actorId: "actor-2",
        accountId: "account-1",
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      consumeSecretSidecar({
        token,
        actorId: "actor-1",
        accountId: "account-1",
        now: 2_000,
      }),
    ).toEqual({
      "request.headers.authorization": "Bearer private",
    });
    expect(
      consumeSecretSidecar({
        token,
        actorId: "actor-1",
        accountId: "account-1",
        now: 2_000,
      }),
    ).toBeNull();

    const expired = createSecretSidecar({
      actorId: "actor-1",
      accountId: "account-1",
      bindings: { token: "private" },
      now: 1_000,
    });
    expect(
      consumeSecretSidecar({
        token: expired,
        actorId: "actor-1",
        accountId: "account-1",
        now: 60 * 60 * 1_000,
      }),
    ).toBeNull();
  });
});
