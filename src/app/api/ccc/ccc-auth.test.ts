import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";

// As rotas do console da CCC rodam com service role e aceitam account_id
// no corpo. O middleware só exige login — então cada handler precisa barrar
// quem não é platform admin ANTES de criar o client service role.

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/auth/platform-admin", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createClient = vi.fn(() => {
  throw new Error("service role não deveria ser criado");
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createClient(),
}));

const processar = await import("./processar/route");
const entregaveis = await import("./entregaveis/route");
const criarTemplates = await import("./criar-templates/route");
const setupFunil = await import("./setup-funil/route");

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/ccc/x?diagnostico_id=d1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const handlers: Array<[string, () => Promise<Response>]> = [
  [
    "POST /processar",
    () =>
      processar.POST(
        req("POST", { diagnostico_id: "d1", montar_funil: true, account_id: "outra" }),
      ),
  ],
  ["GET /entregaveis", () => entregaveis.GET(req("GET"))],
  [
    "PATCH /entregaveis",
    () => entregaveis.PATCH(req("PATCH", { entregavel_id: "e1", status: "aprovado" })),
  ],
  ["POST /criar-templates", () => criarTemplates.POST(req("POST", {}))],
  ["POST /setup-funil", () => setupFunil.POST(req("POST", { account_id: "outra" }))],
];

describe("/api/ccc/* exige platform admin", () => {
  beforeEach(() => {
    requirePlatformAdmin.mockReset();
  });

  it.each(handlers)("%s → 403 para usuário logado que não é admin", async (_, call) => {
    requirePlatformAdmin.mockRejectedValue(new ForbiddenError("Forbidden"));
    const res = await call();
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(handlers)("%s → 401 sem sessão", async (_, call) => {
    requirePlatformAdmin.mockRejectedValue(new UnauthorizedError());
    const res = await call();
    expect(res.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
});
