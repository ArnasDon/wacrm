// ============================================================
// Migração Kommo → CB CRM: o que ALIMENTA a Kommo hoje?
//
// SÓ LEITURA. A Kommo segue recebendo ~30 leads por dia, todos criados por
// integração (medido em 14/09/2026). Antes de desligá-la, cada uma dessas
// portas precisa ser religada ao CB CRM — senão os leads param de chegar em
// qualquer lugar. Lista fontes, webhooks, widgets ativos, motivos de perda e
// tarefas abertas. URLs de webhook saem com a query cortada (costuma levar
// token).
//
// Uso: node scripts/kommo/entradas.mjs
// ============================================================

import { criarCliente } from './api.mjs';

const kommo = criarCliente();

async function tentar(caminho) {
  try {
    return { corpo: await kommo.get(caminho) };
  } catch (err) {
    return { erro: String(err.message).slice(0, 200) };
  }
}

const semQuery = (u) => String(u ?? '').replace(/\?.*$/, '?…');
const r = {};

const fontes = await tentar('/api/v4/sources');
r.fontes =
  fontes.erro ??
  (fontes.corpo?._embedded?.sources ?? []).map((s) => ({
    nome: s.name,
    funil: s.pipeline_id,
    servicos: (s.services ?? []).map((x) => x.type),
  }));

const webhooks = await tentar('/api/v4/webhooks');
r.webhooks =
  webhooks.erro ??
  (webhooks.corpo?._embedded?.webhooks ?? []).map((w) => ({
    destino: semQuery(w.destination),
    ativo: !w.disabled,
    eventos: w.settings,
  }));

const widgets = await tentar('/api/v4/widgets?limit=250');
r.widgets_ativos =
  widgets.erro ??
  (widgets.corpo?._embedded?.widgets ?? []).filter((w) => w.is_active_in_account).map((w) => w.code);

const motivos = await tentar('/api/v4/leads/loss_reasons');
r.motivos_de_perda = motivos.erro ?? (motivos.corpo?._embedded?.loss_reasons ?? []).map((m) => m.name);

const tarefas = await tentar('/api/v4/tasks?filter[is_completed]=0&limit=250');
r.tarefas_abertas_na_primeira_pagina = tarefas.erro ?? (tarefas.corpo?._embedded?.tasks ?? []).length;
r.tarefas_abertas_tem_mais_paginas = Boolean(tarefas.corpo?._links?.next);

console.log(JSON.stringify(r, null, 2));
