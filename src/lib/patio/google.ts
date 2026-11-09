import { createSign } from "node:crypto";

// Acesso do servidor ao Google (Firestore do site e, depois, GA4) com a
// MESMA chave de serviço que o site já usa (env FIREBASE_SERVICE_ACCOUNT,
// o JSON inteiro). O token OAuth2 sai de um JWT assinado com o crypto do
// Node, como o site faz em api/ga4-stats.js — sem biblioteca nova.

type ChaveServico = { client_email: string; private_key: string; project_id?: string };

let chaveEmCache: ChaveServico | null = null;
const tokens = new Map<string, { token: string; expira: number }>();

export function chaveServico(): ChaveServico | null {
  if (chaveEmCache) return chaveEmCache;
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) return null;
  try {
    const c = JSON.parse(bruto) as ChaveServico;
    if (!c.client_email || !c.private_key) return null;
    chaveEmCache = { ...c, private_key: c.private_key.replace(/\\n/g, "\n") };
    return chaveEmCache;
  } catch {
    return null;
  }
}

const b64url = (s: string | Buffer) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function tokenGoogle(escopo: string): Promise<string> {
  const guardado = tokens.get(escopo);
  if (guardado && guardado.expira > Date.now() + 60_000) return guardado.token;
  const chave = chaveServico();
  if (!chave) throw new Error("FIREBASE_SERVICE_ACCOUNT não configurada no servidor");
  const agora = Math.floor(Date.now() / 1000);
  const cabeca = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(
    JSON.stringify({ iss: chave.client_email, scope: escopo, aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 }),
  );
  const assinador = createSign("RSA-SHA256");
  assinador.update(`${cabeca}.${corpo}`);
  const jwt = `${cabeca}.${corpo}.${b64url(assinador.sign(chave.private_key))}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Google recusou a chave de serviço (${r.status})`);
  const d = (await r.json()) as { access_token: string; expires_in?: number };
  tokens.set(escopo, { token: d.access_token, expira: Date.now() + (d.expires_in ?? 3600) * 1000 });
  return d.access_token;
}
