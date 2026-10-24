import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { hashInviteToken } from "@/lib/auth/invitations";

const rpc = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const deleteAccounts = vi.fn();

vi.mock("@/lib/ai/admin-client", () => ({
  supabaseAdmin: () => ({
    rpc,
    from: () => ({ delete: () => ({ eq: deleteAccounts }) }),
    auth: { admin: { createUser, deleteUser } },
  }),
}));

const { POST } = await import("./route");

let n = 0;
function call(token: string, body: unknown) {
  return POST(
    new Request("https://app.test/api/invitations/x/signup", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${++n}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  rpc.mockReset();
  createUser.mockReset();
  deleteUser.mockReset();
  deleteAccounts.mockReset().mockResolvedValue({});
});

describe("POST /api/invitations/[token]/signup — registro cerrado", () => {
  it("rechaza un token que no existe y no crea usuario", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "not_found" }, error: null });
    const res = await call("x", { email: "a@b.co", password: "123456" });
    expect(res.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rechaza invitaciones vencidas o usadas", async () => {
    for (const reason of ["expired", "used"]) {
      rpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
      const res = await call("tok", { email: "a@b.co", password: "123456" });
      expect(res.status).toBe(403);
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it("un invitado se da de alta y la invitación se canjea en el mismo paso", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "peek_invitation"
        ? { data: { ok: true }, error: null }
        : { data: "acct-1", error: null },
    );
    createUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await call("tok", { email: "inv@b.co", password: "123456", fullName: "Inv" });
    expect(res.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "inv@b.co", email_confirm: true }),
    );
    expect(rpc).toHaveBeenCalledWith("redeem_invitation_for_new_user", {
      p_token_hash: hashInviteToken("tok"),
      p_user_id: "u1",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("si el canje falla (carrera) se borra el usuario creado y responde 403", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "peek_invitation"
        ? { data: { ok: true }, error: null }
        : { data: null, error: { code: "22023", message: "already redeemed" } },
    );
    createUser.mockResolvedValue({ data: { user: { id: "u2" } }, error: null });
    const res = await call("tok", { email: "x@b.co", password: "123456" });
    expect(res.status).toBe(403);
    expect(deleteAccounts).toHaveBeenCalledWith("owner_user_id", "u2");
    expect(deleteUser).toHaveBeenCalledWith("u2");
  });

  it("un segundo intento con el mismo token se rechaza sin crear usuario", async () => {
    let used = false;
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "peek_invitation") {
        return { data: used ? { ok: false, reason: "used" } : { ok: true }, error: null };
      }
      used = true;
      return { data: "acct-1", error: null };
    });
    createUser.mockResolvedValue({ data: { user: { id: "u3" } }, error: null });
    expect((await call("tok", { email: "a@b.co", password: "123456" })).status).toBe(201);
    expect((await call("tok", { email: "c@b.co", password: "123456" })).status).toBe(403);
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it("no filtra el mensaje crudo de Auth", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    createUser.mockResolvedValue({
      data: {},
      error: { message: "User already registered" },
    });
    const res = await call("tok", { email: "a@b.co", password: "123456" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("registered");
  });

  it("la migración 060 bloquea la fila y solo concede a service_role", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/060_invitation_signup_redeem.sql"),
      "utf8",
    );
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.redeem_invitation_for_new_user\(TEXT, UUID\) TO service_role/);
    expect(sql).not.toMatch(/redeem_invitation_for_new_user\(TEXT, UUID\) TO (anon|authenticated)/);
  });
});

describe("Auth cerrado en la fuente", () => {
  it("docker-compose desactiva el autorregistro de gotrue por defecto", () => {
    const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose).toContain("GOTRUE_DISABLE_SIGNUP: ${GOTRUE_DISABLE_SIGNUP:-true}");
  });
});
