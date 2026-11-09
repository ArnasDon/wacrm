import { createSign } from "node:crypto";

// Acesso do servidor ao Google (Firestore do site e, depois, GA4) com a
// MESMA chave de serviço que o site já usa (env FIREBASE_SERVICE_ACCOUNT,
// o JSON inteiro). O token OAuth2 sai de um JWT assinado com o crypto do
// Node, como o site faz em api/ga4-stats.js — sem biblioteca nova.

type ChaveServico = { client_email: string; private_key: string; project_id?: string };

let chaveEmCache: ChaveServico | null = null;
const tokens = new Map<string, { token: string; expira: number }>();

/** Quebras de linha reais dentro de textos viram "\n" (o JSON colado com a chave em várias linhas). */
function escaparQuebrasEmTextos(s: string): string {
  let saida = "";
  let emTexto = false;
  let escapando = false;
  for (const ch of s) {
    if (emTexto) {
      if (escapando) escapando = false;
      else if (ch === "\\") escapando = true;
      else if (ch === '"') emTexto = false;
      else if (ch === "\n") { saida += "\\n"; continue; }
      else if (ch === "\r") continue;
    } else if (ch === '"') emTexto = true;
    saida += ch;
  }
  return saida;
}

/**
 * Lê o JSON da chave de serviço aceitando os jeitos comuns de colar na
 * Vercel: JSON puro, entre aspas, com a chave privada em várias linhas ou
 * codificado em base64.
 */
export function lerChaveServico(bruto: string | undefined): ChaveServico | null {
  if (!bruto) return null;
  let s = bruto.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"') && !s.startsWith('"{'))) s = s.slice(1, -1).trim();
  if (s.startsWith('"{')) {
    try { s = JSON.parse(s) as string; } catch { /* segue */ }
  }
  if (!s.startsWith("{")) {
    try { s = Buffer.from(s, "base64").toString("utf8").trim(); } catch { return null; }
  }
  for (const tentativa of [s, escaparQuebrasEmTextos(s)]) {
    try {
      const c = JSON.parse(tentativa) as ChaveServico;
      if (c && c.client_email && c.private_key) return { ...c, private_key: c.private_key.replace(/\\n/g, "\n") };
    } catch { /* próxima */ }
  }
  return null;
}

export function situacaoChave(): "ok" | "ausente" | "invalida" {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return "ausente";
  return chaveServico() ? "ok" : "invalida";
}

export function chaveServico(): ChaveServico | null {
  if (chaveEmCache) return chaveEmCache;
  chaveEmCache = lerChaveServico(process.env.FIREBASE_SERVICE_ACCOUNT);
  return chaveEmCache;
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
