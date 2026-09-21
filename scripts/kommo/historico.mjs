// ============================================================
// Migração Kommo → CB CRM: a Kommo guarda o HISTÓRICO de etapas dos leads?
//
// SÓ LEITURA. Responde a decisão 9 do plano: a carga pode escrever os eventos
// de funil (`cb_lead_events`, origin 'retroativo') com a data REAL de cada
// mudança de etapa, ou só com a criação e o fechamento do lead? Sem isso, o
// funil de eficiência (975) dos meses importados sai com leads que "pularam"
// da entrada direto para o fim.
//
// Uso:
//   node scripts/kommo/historico.mjs --saida <arquivo.jsonl>
//   node scripts/kommo/historico.mjs --saida <arquivo.jsonl> --continuar
//
// O arquivo recebe um evento por linha (ids de lead e de etapa, sem nome nem
// telefone) e fica FORA do repositório; na tela saem só agregados, calculados
// sobre o arquivo INTEIRO.
//
// ⚠️ Os eventos vêm do mais NOVO para o mais antigo, 100 por página (teto da
// rota), e a conta passa de 40 mil — mais que `MAX_PAGINAS`. `--continuar`
// retoma de onde o arquivo parou (pede só eventos anteriores ao mais antigo
// gravado), então uma queda ou o teto não obrigam a recomeçar. O limite do
// intervalo é inclusivo: o segundo da fronteira pode repetir um evento, e a
// contagem deduplica.
// ============================================================

import fs from 'node:fs';

import { criarCliente, MAX_PAGINAS } from './api.mjs';

const args = process.argv.slice(2);
const iSaida = args.indexOf('--saida');
const saida = iSaida >= 0 ? args[iSaida + 1] : null;
const continuar = args.includes('--continuar');
if (!saida) {
  console.error('Uso: node scripts/kommo/historico.mjs --saida <arquivo.jsonl> [--continuar]');
  process.exit(1);
}

function lerArquivo() {
  if (!fs.existsSync(saida)) return [];
  return fs
    .readFileSync(saida, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

let ate = null;
if (continuar) {
  const ja = lerArquivo();
  if (ja.length) ate = ja.reduce((m, e) => Math.min(m, e.em), Infinity);
} else {
  fs.writeFileSync(saida, '');
}

const kommo = criarCliente();
let url =
  '/api/v4/events?filter[type][]=lead_added&filter[type][]=lead_status_changed&limit=100&page=1' +
  // ⚠️ Na rota de EVENTOS o intervalo é `from,to` numa chave só: a forma
  // `[from]`/`[to]` das outras rotas volta 400 "Invalid params" (medido).
  (ate ? `&filter[created_at]=1,${ate}` : '');
let lidos = 0;
let paginas = 0;
let completo = false;
for (; paginas < MAX_PAGINAS; paginas++) {
  const corpo = await kommo.get(url);
  if (!corpo) {
    completo = true;
    break;
  }
  const lote = (corpo._embedded?.events ?? []).map((e) => ({
    id: e.id,
    tipo: e.type,
    lead: e.entity_id,
    em: e.created_at,
    por: e.created_by,
    de: e.value_before?.[0]?.lead_status ?? null,
    para: e.value_after?.[0]?.lead_status ?? null,
  }));
  if (lote.length) fs.appendFileSync(saida, lote.map((e) => JSON.stringify(e)).join('\n') + '\n');
  lidos += lote.length;
  process.stdout.write(`\r  eventos: ${lidos}…   `);
  const proxima = corpo._links?.next?.href;
  if (!proxima || !lote.length) {
    completo = true;
    break;
  }
  url = proxima;
}

// ---------- agregados sobre o arquivo inteiro ----------
const porId = new Map();
for (const e of lerArquivo()) porId.set(e.id ?? `${e.tipo}:${e.lead}:${e.em}`, e);
const eventos = [...porId.values()];
const porTipo = {};
const porMes = {};
const mudancasPorLead = new Map();
for (const e of eventos) {
  porTipo[e.tipo] = (porTipo[e.tipo] ?? 0) + 1;
  const mes = new Date(e.em * 1000).toISOString().slice(0, 7);
  porMes[mes] = (porMes[mes] ?? 0) + 1;
  if (e.tipo === 'lead_status_changed') mudancasPorLead.set(e.lead, (mudancasPorLead.get(e.lead) ?? 0) + 1);
}
const dia = (u) => new Date(u * 1000).toISOString().slice(0, 10);
// reduce, não `Math.min(...)`: com dezenas de milhares de eventos o espalhamento
// estoura a pilha de argumentos.
const ems = eventos.length
  ? [eventos.reduce((m, e) => Math.min(m, e.em), Infinity), eventos.reduce((m, e) => Math.max(m, e.em), 0)]
  : [];
console.log(
  '\n' +
    JSON.stringify(
      {
        esta_rodada: { paginas: paginas + 1, eventos: lidos, chegou_ao_fim: completo },
        arquivo: {
          eventos: eventos.length,
          leads_com_evento: new Set(eventos.map((e) => e.lead)).size,
          leads_com_mudanca_de_etapa: mudancasPorLead.size,
          por_tipo: porTipo,
          mais_antigo: ems.length ? dia(ems[0]) : null,
          mais_recente: ems.length ? dia(ems[1]) : null,
          por_mes: Object.fromEntries(Object.entries(porMes).sort()),
        },
      },
      null,
      2,
    ),
);
if (!completo) console.warn(`⚠️ Teto de ${MAX_PAGINAS} páginas nesta rodada — rodar de novo com --continuar.`);
