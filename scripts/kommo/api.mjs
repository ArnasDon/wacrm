// ============================================================
// Cliente mínimo da API v4 da Kommo, para a migração Kommo → CB CRM.
//
// SÓ LEITURA neste arquivo. Nada aqui escreve na Kommo nem no Supabase.
//
// ⚠️ O teto da Kommo é 7 requisições por segundo POR IP, e estourar não
// devolve só 429: violação repetida BLOQUEIA o IP e passa a responder 403
// para qualquer chamada. Por isso o `aguardarVez` serializa tudo num
// intervalo fixo folgado (5/s) em vez de disparar em paralelo — a migração
// roda uma vez e não tem pressa; perder o acesso no meio dela custaria caro.
// https://developers.kommo.com/docs/limitations
//
// ⚠️ A URL é `https://<subdominio>.kommo.com`, NUNCA o `api_domain` que vem
// dentro do próprio token (`api-g.kommo.com`). Medido em 2026-09-02: o
// api-g devolve 401 com o mesmo token que o subdomínio aceita com 200.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

/** Intervalo entre chamadas: 200ms ≈ 5/s, com folga sobre o teto de 7/s. */
const INTERVALO_MS = 200;

/** Teto de páginas por coleção — trava de segurança contra laço infinito. */
export const MAX_PAGINAS = 400;

let proximaLivreEm = 0;

async function aguardarVez() {
  const agora = Date.now();
  const espera = Math.max(0, proximaLivreEm - agora);
  proximaLivreEm = Math.max(agora, proximaLivreEm) + INTERVALO_MS;
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}

/**
 * Lê `.env.local` sem depender de `--env-file`: o arquivo tem valores com
 * `#`, `=` e base64 no meio, e um parser tolerante evita surpresa silenciosa
 * (variável vindo vazia é indistinguível de token errado — dá 401 nos dois).
 */
export function carregarEnv(raiz = process.cwd()) {
  const arquivo = path.join(raiz, '.env.local');
  if (!fs.existsSync(arquivo)) {
    throw new Error(`.env.local não encontrado em ${raiz}`);
  }
  const env = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

export function criarCliente(env = carregarEnv()) {
  const token = env.KOMMO_TOKEN;
  const base = (env.KOMMO_API_BASE || '').replace(/\/+$/, '');
  if (!token) throw new Error('KOMMO_TOKEN ausente do .env.local');
  if (!base) throw new Error('KOMMO_API_BASE ausente do .env.local');

  /** GET cru, com repetição em 429/5xx. Devolve `null` no 204 (coleção vazia). */
  async function get(caminho, tentativa = 0) {
    await aguardarVez();
    const url = caminho.startsWith('http') ? caminho : `${base}${caminho}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      // ⚠️ Queda de rede NÃO é 5xx: o `fetch` rejeita ("other side closed",
      // tempo esgotado) e, sem este ramo, uma varredura de vários minutos
      // morria inteira no meio — medido em 14/09/2026 no histórico de etapas,
      // depois de 3 MB lidos. GET é seguro de repetir.
      if (tentativa < 5) {
        const espera = 2 ** tentativa * 1000;
        console.warn(`  ↻ ${err.cause?.code ?? err.name} em ${url} — repetindo em ${espera}ms`);
        await new Promise((r) => setTimeout(r, espera));
        return get(caminho, tentativa + 1);
      }
      throw err;
    }

    // ⚠️ 204 é resposta NORMAL da Kommo para coleção vazia — não é erro, e
    // `res.json()` num corpo vazio estoura. Tratar como falha faria o
    // levantamento abortar numa conta que só não tem empresas cadastradas.
    if (res.status === 204) return null;

    if ((res.status === 429 || res.status >= 500) && tentativa < 5) {
      const espera = 2 ** tentativa * 1000;
      console.warn(`  ↻ HTTP ${res.status} em ${url} — repetindo em ${espera}ms`);
      await new Promise((r) => setTimeout(r, espera));
      return get(caminho, tentativa + 1);
    }

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} em ${url} — ${corpo.slice(0, 300)}`);
    }
    return res.json();
  }

  /**
   * Percorre uma coleção paginada e devolve TODOS os itens.
   *
   * A Kommo não informa total; o fim é o desaparecimento de `_links.next`.
   * `chave` é o nome dentro de `_embedded` (`leads`, `contacts`, `notes`…).
   */
  async function listarTudo(caminho, chave, { rotulo = caminho } = {}) {
    const itens = [];
    const sep = caminho.includes('?') ? '&' : '?';
    let url = `${caminho}${sep}limit=250&page=1`;

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const corpo = await get(url);
      if (!corpo) break;
      const lote = corpo._embedded?.[chave] ?? [];
      itens.push(...lote);
      process.stdout.write(`\r  ${rotulo}: ${itens.length}…   `);

      const proxima = corpo._links?.next?.href;
      if (!proxima || lote.length === 0) break;
      url = proxima;

      if (pagina === MAX_PAGINAS) {
        console.warn(`\n  ⚠️ ${rotulo}: teto de ${MAX_PAGINAS} páginas atingido — lista INCOMPLETA.`);
      }
    }

    process.stdout.write(`\r  ${rotulo}: ${itens.length} ✓          \n`);
    return itens;
  }

  return { get, listarTudo, base };
}

/**
 * Telefone normalizado no MESMO formato do CB CRM: só dígitos.
 * Espelha `normalizePhone` (src/lib/whatsapp/phone-utils.ts) e a coluna
 * gerada `contacts.phone_normalized` (migration 022) — é por ela que o
 * índice único `(account_id, phone_normalized)` decide o que é duplicata.
 */
export function normalizarTelefone(bruto) {
  return String(bruto ?? '').replace(/\D/g, '');
}

/**
 * Extrai os valores de um campo de sistema (`PHONE`, `EMAIL`) de uma
 * entidade da Kommo. Eles NÃO são colunas: vivem em `custom_fields_values`
 * junto com os campos criados pelo escritório, distinguidos por `field_code`.
 */
export function valoresDoCampo(entidade, codigo) {
  const campos = entidade?.custom_fields_values ?? [];
  const campo = campos.find((c) => c?.field_code === codigo);
  return (campo?.values ?? [])
    .map((v) => (v?.value == null ? '' : String(v.value).trim()))
    .filter(Boolean);
}
