// Regras do carro do Pátio: como o documento do site vira um carro do
// sistema, o que cada papel vê e pode mudar, e como o carro volta para o
// Firestore no MESMO formato que o admin do site grava (firebase-init.js,
// setVehicle). Funções puras: testadas em veiculo.test.ts.

export type Papel = "socio" | "marketing" | "vendedor";

export type Foto = { url: string; [k: string]: unknown };

export type Carro = {
  id: string;
  cat?: string;
  status?: string; // available | reserved | sold | unavailable | review
  brand?: string;
  model?: string;
  versao?: string;
  year?: string | number;
  mileage?: string | number;
  color?: string;
  plate?: string;
  chassis?: string;
  badge?: string;
  description?: string;
  combustivel?: string;
  cambio?: string;
  img?: string;
  images?: Foto[];
  video?: string;
  ownership_type?: string;
  oferta?: boolean;
  premium?: boolean;
  ordem?: number;
  ipva?: string;
  chave_manual?: boolean;
  revisoes?: string;
  origem?: unknown;
  checklist?: Record<string, unknown>;
  finance?: Record<string, unknown>;
  seller?: Record<string, unknown>;
  sale?: Record<string, unknown>;
  documents?: unknown[];
  unavailable?: unknown;
  entrada?: unknown;
  // vindos do Firestore (metadados), não gravados de volta
  criado_em?: string | null;
  atualizado_em?: string | null;
};

/** Junta o documento público e o privado como o admin faz ao carregar. */
export function montarCarro(
  id: string,
  publico: Record<string, unknown>,
  privado: Record<string, unknown>,
  meta?: { criadoEm?: string | null; atualizadoEm?: string | null },
): Carro {
  const c = { ...publico, ...privado, id } as Carro;
  // ipva / chave_manual / revisoes moram no doc público, mas o formulário
  // do admin lê de checklist: junta os dois para ninguém perder o dado.
  c.checklist = {
    ...(c.checklist || {}),
    ipva: (c.checklist?.ipva as string) ?? c.ipva ?? "",
    chave_manual: (c.checklist?.chave_manual as boolean) ?? c.chave_manual ?? false,
    revisoes: (c.checklist?.revisoes as string) ?? c.revisoes ?? "",
  };
  // o site lê "oferta"; versões antigas gravavam "premium"
  if (c.oferta === undefined && c.premium !== undefined) c.oferta = !!c.premium;
  c.criado_em = meta?.criadoEm ?? null;
  c.atualizado_em = meta?.atualizadoEm ?? null;
  return c;
}

/**
 * Separa o carro nos dois documentos do Firestore. Cópia fiel de
 * setVehicle (firebase-init.js do site), com DUAS correções: grava também
 * "oferta" (o site lê esse campo para a vitrine de Ofertas, mas o admin só
 * gravava "premium") e o preço "De:" (finance.old_price), que o site lê do
 * documento público mas o admin guardava só no privado.
 */
export function separarParaFirestore(v: Carro): { publico: Record<string, unknown>; privado: Record<string, unknown> } {
  const clean = JSON.parse(JSON.stringify(v)) as Carro;
  const publico: Record<string, unknown> = {
    id: clean.id,
    cat: clean.cat,
    status: clean.status,
    brand: clean.brand,
    model: clean.model,
    year: clean.year,
    mileage: clean.mileage,
    color: clean.color,
    plate: clean.plate,
    chassis: clean.chassis || "",
    badge: clean.badge,
    description: clean.description,
    img: clean.img,
    images: clean.images,
    video: clean.video,
    versao: clean.versao || "",
    combustivel: clean.combustivel || "",
    cambio: clean.cambio || "",
    ipva: (clean.checklist?.ipva as string) || "",
    chave_manual: !!clean.checklist?.chave_manual,
    revisoes: (clean.checklist?.revisoes as string) || "",
    ownership_type: clean.ownership_type || "proprio",
    premium: !!clean.oferta,
    oferta: !!clean.oferta,
    ordem: Number(clean.ordem) || 0,
    finance: {
      sale_price: (clean.finance?.sale_price as number | undefined) ?? 0,
      ...(clean.finance?.old_price ? { old_price: clean.finance.old_price } : {}),
    },
    ...(clean.origem ? { origem: clean.origem } : {}),
  };
  for (const k of Object.keys(publico)) if (publico[k] === undefined) delete publico[k];
  const privado: Record<string, unknown> = {
    seller: clean.seller || {},
    finance: clean.finance || {},
    sale: clean.sale || {},
    documents: clean.documents || [],
    unavailable: clean.unavailable || null,
    ...(clean.entrada ? { entrada: clean.entrada } : {}),
    checklist: {
      laudo: (clean.checklist?.laudo as string) || "",
      pneus: (clean.checklist?.pneus as string) || "",
      captacao: (clean.checklist?.captacao as string) || "",
    },
  };
  return { publico, privado };
}

/** O que cada papel enxerga. Sócio vê tudo; os demais não veem dono, custos, venda nem documentos. */
export function filtrarParaPapel(c: Carro, papel: Papel): Carro {
  if (papel === "socio") return c;
  const { seller: _s, sale: _v, documents: _d, entrada: _e, ...resto } = c;
  void _s; void _v; void _d; void _e;
  return { ...resto, finance: { sale_price: c.finance?.sale_price ?? 0, old_price: c.finance?.old_price ?? 0 } };
}

// Campos que cada papel pode mudar. Vendedor só consulta.
const CAMPOS_SITE = [
  "cat", "status", "brand", "model", "versao", "year", "mileage", "color", "plate", "chassis", "badge",
  "description", "combustivel", "cambio", "video", "oferta", "ordem", "images", "img", "unavailable",
] as const;
const CHECKLIST_SITE = ["ipva", "chave_manual", "revisoes", "laudo", "pneus", "captacao"] as const;
const FINANCE_PUBLICO = ["sale_price", "old_price"] as const;
const SO_SOCIO = ["ownership_type", "seller", "sale", "documents"] as const;

export const STATUS_VALIDOS = ["available", "reserved", "sold", "unavailable", "review"];

export type ResultadoPatch = { carro: Carro; campos: string[] } | { erro: string };

/** Aplica uma mudança respeitando o papel. Devolve o carro novo e a lista do que mudou. */
export function aplicarMudanca(atual: Carro, mudanca: Record<string, unknown>, papel: Papel): ResultadoPatch {
  if (papel === "vendedor") return { erro: "Vendedor pode consultar o pátio, mas não alterar." };
  const novo: Carro = JSON.parse(JSON.stringify(atual));
  const campos: string[] = [];
  const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  for (const [chave, valor] of Object.entries(mudanca)) {
    if ((CAMPOS_SITE as readonly string[]).includes(chave)) {
      if (chave === "status" && !STATUS_VALIDOS.includes(String(valor))) return { erro: `Status inválido: ${String(valor)}` };
      if (chave === "status" && valor === "sold" && papel !== "socio") return { erro: "Só sócio marca um carro como vendido." };
      if (!igual((novo as Record<string, unknown>)[chave], valor)) {
        (novo as Record<string, unknown>)[chave] = valor;
        campos.push(chave);
      }
    } else if (chave === "checklist" && valor && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
        if (!(CHECKLIST_SITE as readonly string[]).includes(k)) return { erro: `Campo não permitido: checklist.${k}` };
        if (!igual(novo.checklist?.[k], v)) {
          novo.checklist = { ...(novo.checklist || {}), [k]: v };
          campos.push(`checklist.${k}`);
        }
      }
    } else if (chave === "finance" && valor && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
        if (papel !== "socio" && !(FINANCE_PUBLICO as readonly string[]).includes(k)) return { erro: "Só sócio altera o financeiro do carro." };
        if (!igual(novo.finance?.[k], v)) {
          novo.finance = { ...(novo.finance || {}), [k]: v };
          campos.push(`finance.${k}`);
        }
      }
    } else if ((SO_SOCIO as readonly string[]).includes(chave)) {
      if (papel !== "socio") return { erro: "Só sócio altera dono, venda e documentos." };
      if (!igual((novo as Record<string, unknown>)[chave], valor)) {
        (novo as Record<string, unknown>)[chave] = valor;
        campos.push(chave);
      }
    } else {
      return { erro: `Campo não permitido: ${chave}` };
    }
  }
  // a foto de capa acompanha a primeira foto, como no admin
  if (campos.includes("images") && !campos.includes("img")) {
    const capa = novo.images?.[0]?.url || "";
    if (capa !== novo.img) {
      novo.img = capa;
      campos.push("img");
    }
  }
  return { carro: novo, campos };
}

/** Dias desde que o carro entrou (data de criação do documento no Firestore). */
export function diasNoPatio(c: Pick<Carro, "criado_em">, agora = Date.now()): number | null {
  if (!c.criado_em) return null;
  const t = Date.parse(c.criado_em);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((agora - t) / 86_400_000));
}

/** Recorte de "antes" e "depois" só dos campos que mudaram, para o histórico. */
export function recorte(c: Carro, campos: string[]): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const campo of campos) {
    const [a, b] = campo.split(".");
    const valor = b ? ((c as Record<string, unknown>)[a] as Record<string, unknown> | undefined)?.[b] : (c as Record<string, unknown>)[a];
    saida[campo] = campo === "images" ? (Array.isArray(valor) ? `${valor.length} fotos` : valor) : valor ?? null;
  }
  return saida;
}
