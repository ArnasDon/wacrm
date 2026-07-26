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
      flowId: "flow-1",
      digest: "a".repeat(64),
      bindings: { "request.headers.authorization": "Bearer private" },
      now: 1_000,
    });

    expect(
      consumeSecretSidecar({
        token,
        actorId: "actor-2",
        accountId: "account-1",
        flowId: "flow-1",
        digest: "a".repeat(64),
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      consumeSecretSidecar({
        token,
        actorId: "actor-1",
        accountId: "account-1",
        flowId: "flow-1",
        digest: "b".repeat(64),
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      consumeSecretSidecar({
        token,
        actorId: "actor-1",
        accountId: "account-1",
        flowId: "flow-1",
        digest: "a".repeat(64),
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
        flowId: "flow-1",
        digest: "a".repeat(64),
        now: 2_000,
      }),
    ).toBeNull();

    const expired = createSecretSidecar({
      actorId: "actor-1",
      accountId: "account-1",
      digest: "c".repeat(64),
      bindings: { token: "private" },
      now: 1_000,
    });
    expect(
      consumeSecretSidecar({
        token: expired,
        actorId: "actor-1",
        accountId: "account-1",
        digest: "c".repeat(64),
        now: 60 * 60 * 1_000,
      }),
    ).toBeNull();
  });
});
