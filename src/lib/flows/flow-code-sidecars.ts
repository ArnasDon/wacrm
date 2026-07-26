import { randomUUID } from "node:crypto";

const SIDECAR_TTL_MS = 10 * 60 * 1_000;
const MAX_SIDECARS = 500;
const MAX_BINDINGS = 100;
const MAX_SECRET_LENGTH = 16_384;

interface SecretSidecar {
  actorId: string;
  accountId: string;
  expiresAt: number;
  bindings: Record<string, string>;
}

const sidecars = new Map<string, SecretSidecar>();

function purge(now: number) {
  for (const [token, sidecar] of sidecars) {
    if (sidecar.expiresAt <= now) sidecars.delete(token);
  }
  while (sidecars.size >= MAX_SIDECARS) {
    const oldest = sidecars.keys().next().value as string | undefined;
    if (!oldest) break;
    sidecars.delete(oldest);
  }
}

export function createSecretSidecar(args: {
  actorId: string;
  accountId: string;
  bindings: Record<string, string>;
  now?: number;
}): string {
  const entries = Object.entries(args.bindings);
  if (
    entries.length < 1 ||
    entries.length > MAX_BINDINGS ||
    entries.some(
      ([name, value]) =>
        !/^[a-zA-Z0-9_.:-]{1,256}$/.test(name) ||
        !value ||
        value.length > MAX_SECRET_LENGTH,
    )
  ) {
    throw new Error("INVALID_SECRET_SIDECAR");
  }
  const now = args.now ?? Date.now();
  purge(now);
  const token = randomUUID();
  sidecars.set(token, {
    actorId: args.actorId,
    accountId: args.accountId,
    expiresAt: now + SIDECAR_TTL_MS,
    bindings: Object.fromEntries(entries),
  });
  return token;
}

export function consumeSecretSidecar(args: {
  token: string;
  actorId: string;
  accountId: string;
  now?: number;
}): Record<string, string> | null {
  const now = args.now ?? Date.now();
  purge(now);
  const sidecar = sidecars.get(args.token);
  if (
    !sidecar ||
    sidecar.actorId !== args.actorId ||
    sidecar.accountId !== args.accountId
  ) {
    return null;
  }
  sidecars.delete(args.token);
  return { ...sidecar.bindings };
}

export function clearSecretSidecarsForTests() {
  sidecars.clear();
}
