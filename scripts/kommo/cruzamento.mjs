// ============================================================
// Migração Kommo → CB CRM: CRUZAMENTO dos dois lados (fase 1, só leitura).
//
// Lê dois arquivos locais — o bruto do `levantamento.mjs` e a foto dos
// contatos do CB CRM (`destino-contatos.sql`) — e imprime só AGREGADOS:
// nenhum telefone, nenhum nome de cliente. Não fala com a Kommo nem com o
// Supabase.
//
// Uso (Node com remoção de tipos — o 24 faz sozinho; no 22 pode exigir
// `--experimental-strip-types`, porque importa `.ts` do app):
//   node scripts/kommo/cruzamento.mjs --kommo <kommo-bruto.json> --destino <destino.json>
//
// ⚠️ O telefone é normalizado pelo MESMO módulo do app
// (`src/lib/contacts/telefone.ts`), nunca por um `replace(/\D/g, '')` cru: a
// Kommo devolve "(96) 99112-6767" sem DDI, e só `digitosDoTelefone` sabe
// quando dar o 55. E dois contatos são "o mesmo" pela chave SEM o nono
// dígito, que é como `findExistingContact` casa (últimos 8 dígitos) — o
// índice único `(account_id, phone_normalized)` sozinho deixaria passar
// "5583988745316" e "558388745316" como duas pessoas.
// ============================================================

import fs from 'node:fs';

import { digitosDoTelefone, variantesDoNonoDigito } from '../../src/lib/contacts/telefone.ts';

const args = process.argv.slice(2);
const arg = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const arqKommo = arg('--kommo');
const arqDestino = arg('--destino');
if (!arqKommo || !arqDestino) {
  console.error('Uso: node scripts/kommo/cruzamento.mjs --kommo <kommo-bruto.json> --destino <destino.json>');
  process.exit(1);
}

const k = JSON.parse(fs.readFileSync(arqKommo, 'utf8'));
const destino = JSON.parse(fs.readFileSync(arqDestino, 'utf8'));

/** Data de corte de "recente": 7 dias antes do bruto. */
const geradoEm = new Date(k.gerado_em);
const corte = new Date(geradoEm.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

const dia = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);
const somar = (o, chave) => {
  o[chave] = (o[chave] ?? 0) + 1;
};
const ordenado = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const valores = (e, codigo) =>
  (e?.custom_fields_values ?? [])
    .find((c) => c?.field_code === codigo)
    ?.values?.map((v) => String(v?.value ?? '').trim())
    .filter(Boolean) ?? [];

/** A grafia SEM o nono dígito quando há irmã — a chave de "mesma pessoa". */
function chaveDoTelefone(digitos) {
  const variantes = variantesDoNonoDigito(digitos);
  return variantes.find((v) => v.length === 12) ?? variantes[0];
}

const ehAberto = (lead) => lead.status_id !== 142 && lead.status_id !== 143;
const contatoPrincipal = (lead) => {
  const vinculados = lead._embedded?.contacts ?? [];
  return vinculados.find((c) => c.is_main) ?? vinculados[0];
};

// ---------------- contatos da Kommo ----------------
const kommoPorChave = new Map();
const chaveDoContato = new Map();
let semTelefone = 0;
let telefoneInvalido = 0;
let foraDoBrasil = 0;
for (const c of k.contatos) {
  const telefones = valores(c, 'PHONE');
  if (!telefones.length) {
    semTelefone++;
    continue;
  }
  const digitos = digitosDoTelefone(telefones[0]);
  if (!digitos) {
    telefoneInvalido++;
    continue;
  }
  if (!digitos.startsWith('55')) foraDoBrasil++;
  const chave = chaveDoTelefone(digitos);
  if (!kommoPorChave.has(chave)) kommoPorChave.set(chave, []);
  kommoPorChave.get(chave).push(c);
  chaveDoContato.set(c.id, chave);
}
const duplicados = [...kommoPorChave.values()].filter((l) => l.length > 1);

// ---------------- contatos do CB CRM ----------------
const destinoPorChave = new Map();
for (const c of destino) {
  if (!c.phone_normalized) continue;
  const chave = chaveDoTelefone(c.phone_normalized);
  if (!destinoPorChave.has(chave)) destinoPorChave.set(chave, []);
  destinoPorChave.get(chave).push(c);
}
const nosDois = [...kommoPorChave.keys()].filter((ch) => destinoPorChave.has(ch));
const destinoNosDois = nosDois.flatMap((ch) => destinoPorChave.get(ch));
const noCbCrm = (lead) => {
  const principal = contatoPrincipal(lead);
  const chave = principal && chaveDoContato.get(principal.id);
  return chave ? destinoPorChave.get(chave)?.[0] ?? null : null;
};

// ---------------- leads ----------------
const nomeDoFunil = new Map(k.funis.map((f) => [f.id, f.name]));
const nomeDaEtapa = new Map(
  k.funis.flatMap((f) => (f._embedded?.statuses ?? []).map((s) => [`${f.id}:${s.id}`, s.name])),
);
const nomeDoUsuario = new Map(k.usuarios.map((u) => [u.id, u.name]));
const rotuloDaEtapa = (l) =>
  `${nomeDoFunil.get(l.pipeline_id)} › ${
    l.status_id === 142 ? 'GANHO' : l.status_id === 143 ? 'PERDIDO' : nomeDaEtapa.get(`${l.pipeline_id}:${l.status_id}`)
  }`;
const quem = (id) => (id === 0 ? '(robô/integração)' : nomeDoUsuario.get(id) ?? `(usuário ${id})`);

const abertosPorFunil = {};
const porResponsavel = {};
const leadsPorContato = {};
const abertosPorContato = {};
for (const l of k.leads) {
  somar(porResponsavel, quem(l.responsible_user_id));
  const principal = contatoPrincipal(l);
  if (principal) somar(leadsPorContato, principal.id);
  if (ehAberto(l)) {
    somar(abertosPorFunil, nomeDoFunil.get(l.pipeline_id));
    if (principal) somar(abertosPorContato, principal.id);
  }
}

const recentes = k.leads.filter((l) => dia(l.created_at) >= corte);
const entradaRecente = { por_dia: {}, por_etapa: {}, criado_por: {}, tags: {} };
for (const l of recentes) {
  somar(entradaRecente.por_dia, dia(l.created_at));
  somar(entradaRecente.por_etapa, rotuloDaEtapa(l));
  somar(entradaRecente.criado_por, quem(l.created_by));
  for (const t of l._embedded?.tags ?? []) somar(entradaRecente.tags, t.name);
}
const mexidosRecentes = k.leads.filter((l) => dia(l.created_at) < corte && dia(l.updated_at) >= corte);
const mexidosPorQuem = {};
for (const l of mexidosRecentes) somar(mexidosPorQuem, quem(l.updated_by));

// ---------------- anotações ----------------
const leadPorId = new Map(k.leads.map((l) => [l.id, l]));
const notasDeTexto = k.notas_de_lead.filter((n) => n.note_type === 'common');
const notasComConversaNoDestino = notasDeTexto.filter((n) => {
  const lead = leadPorId.get(n.entity_id);
  const principal = lead && contatoPrincipal(lead);
  const chave = principal && chaveDoContato.get(principal.id);
  return chave && destinoPorChave.get(chave)?.some((c) => c.tem_conversa);
}).length;

const saida = {
  kommo_gerado_em: k.gerado_em,
  recente_desde: corte,
  contatos: {
    total: k.contatos.length,
    sem_telefone: semTelefone,
    telefone_que_nao_parece_telefone: telefoneInvalido,
    fora_do_brasil: foraDoBrasil,
    distintos: kommoPorChave.size,
    numeros_duplicados: duplicados.length,
    contatos_em_duplicata: duplicados.reduce((s, l) => s + l.length, 0),
    com_email: k.contatos.filter((c) => valores(c, 'EMAIL').length).length,
    nomes_com_ideograma: k.contatos.filter((c) => /[㐀-鿿]/.test(c.name ?? '')).length,
  },
  sobreposicao: {
    contatos_no_cb_crm: destino.length,
    numeros_nos_dois: nosDois.length,
    so_na_kommo: kommoPorChave.size - nosDois.length,
    so_no_cb_crm: [...destinoPorChave.keys()].filter((ch) => !kommoPorChave.has(ch)).length,
    nos_dois_criados_pelo_asaas: destinoNosDois.filter((c) => c.da_asaas).length,
    nos_dois_com_mensagens: destinoNosDois.filter((c) => Number(c.mensagens) > 0).length,
    nos_dois_com_negocio: destinoNosDois.filter((c) => c.tem_negocio).length,
    nos_dois_com_nome_fixado: destinoNosDois.filter((c) => c.nome_fixado).length,
    nos_dois_com_campo_preenchido: destinoNosDois.filter((c) => Number(c.campos_preenchidos) > 0).length,
    nos_dois_com_nome_diferente: nosDois.filter((ch) => {
      const a = (kommoPorChave.get(ch)[0].name ?? '').trim().toLowerCase();
      const b = (destinoPorChave.get(ch)[0].name ?? '').trim().toLowerCase();
      return a && b && a !== b;
    }).length,
  },
  leads: {
    total: k.leads.length,
    ganhos: k.leads.filter((l) => l.status_id === 142).length,
    perdidos: k.leads.filter((l) => l.status_id === 143).length,
    abertos: k.leads.filter(ehAberto).length,
    abertos_por_funil: ordenado(abertosPorFunil),
    abertos_de_contato_que_ja_esta_no_cb_crm: k.leads.filter((l) => ehAberto(l) && noCbCrm(l)).length,
    com_motivo_de_perda: k.leads.filter((l) => l.loss_reason_id).length,
    com_valor: k.leads.filter((l) => Number(l.price) > 0).length,
    sem_contato: k.leads.filter((l) => !(l._embedded?.contacts ?? []).length).length,
    contatos_com_mais_de_um_lead: Object.values(leadsPorContato).filter((n) => n > 1).length,
    contatos_com_mais_de_um_lead_aberto: Object.values(abertosPorContato).filter((n) => n > 1).length,
    por_responsavel: ordenado(porResponsavel),
  },
  a_kommo_ainda_esta_viva: {
    leads_criados_nos_7_dias: recentes.length,
    ...Object.fromEntries(Object.entries(entradaRecente).map(([ch, o]) => [ch, ch === 'por_dia' ? o : ordenado(o)])),
    desses_com_contato_ja_no_cb_crm: recentes.filter((l) => noCbCrm(l)).length,
    leads_antigos_mexidos_nos_7_dias: mexidosRecentes.length,
    mexidos_por: ordenado(mexidosPorQuem),
    fechados_nos_7_dias: k.leads.filter((l) => dia(l.closed_at) >= corte).length,
  },
  anotacoes: {
    de_texto_em_lead: notasDeTexto.length,
    de_texto_em_contato: k.notas_de_contato.filter((n) => n.note_type === 'common').length,
    criadas_nos_7_dias: notasDeTexto.filter((n) => dia(n.created_at) >= corte).length,
    de_lead_cujo_contato_ja_tem_conversa_no_cb_crm: notasComConversaNoDestino,
  },
};

console.log(JSON.stringify(saida, null, 2));
