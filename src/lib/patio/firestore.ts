import { tokenGoogle } from "./google";

// Firestore do site pela API REST, autenticado com a chave de serviço.
// Só servidor. Lê e grava a coleção "vehicles" (documento público) e a
// subcoleção "vehicles/{id}/private/data" (custos, dono, venda) — o mesmo
// desenho que o admin do site usa em firebase-init.js.

const ESCOPO = "https://www.googleapis.com/auth/datastore";

export type Valor =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: Valor[] } }
  | { mapValue: { fields?: Record<string, Valor> } }
  | Record<string, unknown>;

export function decodificar(v: Valor | undefined): unknown {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if ("nullValue" in o) return null;
  if ("booleanValue" in o) return Boolean(o.booleanValue);
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return Number(o.doubleValue);
  if ("stringValue" in o) return String(o.stringValue);
  if ("timestampValue" in o) return String(o.timestampValue);
  if ("referenceValue" in o) return String(o.referenceValue);
  if ("arrayValue" in o) return ((o.arrayValue as { values?: Valor[] }).values || []).map(decodificar);
  if ("mapValue" in o) return decodificarCampos((o.mapValue as { fields?: Record<string, Valor> }).fields);
  return null;
}

export function decodificarCampos(campos: Record<string, Valor> | undefined): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos || {})) saida[k] = decodificar(v);
  return saida;
}

export function codificar(x: unknown): Valor {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === "string") return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.filter((i) => i !== undefined).map(codificar) } };
  if (typeof x === "object") return { mapValue: { fields: codificarCampos(x as Record<string, unknown>) } };
  return { stringValue: String(x) };
}

export function codificarCampos(obj: Record<string, unknown>): Record<string, Valor> {
  const saida: Record<string, Valor> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) saida[k] = codificar(v);
  return saida;
}

const raiz = (projeto: string) =>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projeto)}/databases/(default)/documents`;
const nomeDoc = (projeto: string, caminho: string) => `projects/${projeto}/databases/(default)/documents/${caminho}`;

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await tokenGoogle(ESCOPO);
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!r.ok) {
    const texto = await r.text().catch(() => "");
    throw new Error(`Firestore ${r.status}: ${texto.slice(0, 300)}`);
  }
  return (await r.json()) as T;
}

type DocRest = { name: string; fields?: Record<string, Valor>; createTime?: string; updateTime?: string };

export type DocLido = { id: string; dados: Record<string, unknown>; criadoEm: string | null; atualizadoEm: string | null };

/** Todos os documentos públicos de "vehicles". */
export async function listarPublicos(projeto: string): Promise<DocLido[]> {
  const saida: DocLido[] = [];
  let pagina = "";
  for (let i = 0; i < 30; i++) {
    const url = `${raiz(projeto)}/vehicles?pageSize=300${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`;
    const d = await chamar<{ documents?: DocRest[]; nextPageToken?: string }>(url);
    for (const doc of d.documents || []) {
      saida.push({
        id: doc.name.split("/").pop() || doc.name,
        dados: decodificarCampos(doc.fields),
        criadoEm: doc.createTime ?? null,
        atualizadoEm: doc.updateTime ?? null,
      });
    }
    if (!d.nextPageToken) break;
    pagina = d.nextPageToken;
  }
  return saida;
}

/** Documentos privados ("vehicles/{id}/private/data") de vários carros de uma vez. */
export async function lerPrivados(projeto: string, ids: string[]): Promise<Record<string, Record<string, unknown>>> {
  const saida: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const resp = await chamar<{ found?: DocRest; missing?: string }[]>(`${raiz(projeto)}:batchGet`, {
      method: "POST",
      body: JSON.stringify({ documents: lote.map((id) => nomeDoc(projeto, `vehicles/${id}/private/data`)) }),
    });
    for (const item of resp) {
      if (!item.found) continue;
      const partes = item.found.name.split("/");
      const id = partes[partes.length - 3];
      saida[id] = decodificarCampos(item.found.fields);
    }
  }
  return saida;
}

export async function lerUm(projeto: string, id: string): Promise<{ publico: DocLido; privado: Record<string, unknown> } | null> {
  const resp = await chamar<{ found?: DocRest; missing?: string }[]>(`${raiz(projeto)}:batchGet`, {
    method: "POST",
    body: JSON.stringify({ documents: [nomeDoc(projeto, `vehicles/${id}`), nomeDoc(projeto, `vehicles/${id}/private/data`)] }),
  });
  let publico: DocLido | null = null;
  let privado: Record<string, unknown> = {};
  for (const item of resp) {
    if (!item.found) continue;
    if (item.found.name.endsWith("/private/data")) privado = decodificarCampos(item.found.fields);
    else
      publico = {
        id,
        dados: decodificarCampos(item.found.fields),
        criadoEm: item.found.createTime ?? null,
        atualizadoEm: item.found.updateTime ?? null,
      };
  }
  return publico ? { publico, privado } : null;
}

/** Grava os dois documentos numa transação só (substitui, como o .set() do admin). */
export async function gravarCarro(projeto: string, id: string, publico: Record<string, unknown>, privado: Record<string, unknown>) {
  await chamar(`${raiz(projeto)}:commit`, {
    method: "POST",
    body: JSON.stringify({
      writes: [
        { update: { name: nomeDoc(projeto, `vehicles/${id}`), fields: codificarCampos(publico) } },
        { update: { name: nomeDoc(projeto, `vehicles/${id}/private/data`), fields: codificarCampos(privado) } },
      ],
    }),
  });
}

/** Lê um documento avulso (ex.: "site/config"). */
export async function lerDocumento(projeto: string, caminho: string): Promise<Record<string, unknown> | null> {
  try {
    const d = await chamar<DocRest>(`${raiz(projeto)}/${caminho}`);
    return decodificarCampos(d.fields);
  } catch {
    return null;
  }
}
