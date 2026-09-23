// ============================================================
// FASE 1 da migração Kommo → CB CRM: levantamento.
//
// SÓ LEITURA. Este script não escreve nada — nem na Kommo, nem no Supabase.
// Ele responde, com números, as perguntas que decidem o resto da migração:
//
//   · Quantos contatos NÃO têm telefone? (desde a 989 `contacts.phone` é
//     anulável, mas o CHECK exige telefone OU Instagram — contato da Kommo
//     sem telefone continua sem como existir lá.)
//   · Quantos telefones colidem depois de normalizados? (o índice único
//     `(account_id, phone_normalized)` da 022 funde os dois num só.)
//     ⚠️ A conta daqui usa só dígitos crus; a que vale para a carga é a do
//     `cruzamento.mjs`, pelo `digitosDoTelefone` do app e com o nono dígito.
//   · Quais campos personalizados existem, de que tipo, e quantos estão de
//     fato preenchidos? (no CB CRM: `text`, `datetime`, `select` e `number`
//     desde a 948, e só em CONTATO.)
//   · Quantas anotações existem? (elas exigem CONVERSA no CB CRM — a
//     `cb_conversation_notes.conversation_id` é NOT NULL desde a 918.)
//
// Uso:
//   node scripts/kommo/levantamento.mjs [--saida <pasta>]
//
// A pasta de saída recebe o JSON bruto (dado de CLIENTE — não versionar) e o
// relatório em Markdown. Padrão: ./.kommo-levantamento, que está no
// .gitignore junto com o resto do `.env*`… não: é ignorada explicitamente.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

import {
  criarCliente,
  normalizarTelefone,
  valoresDoCampo,
} from './api.mjs';

const args = process.argv.slice(2);
const iSaida = args.indexOf('--saida');
const PASTA_SAIDA = iSaida >= 0 ? args[iSaida + 1] : '.kommo-levantamento';

function pct(parte, total) {
  if (!total) return '0%';
  return `${((parte / total) * 100).toFixed(1)}%`;
}

/** Conta ocorrências e devolve pares [chave, n] do maior para o menor. */
function ranking(mapa) {
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const kommo = criarCliente();
  console.log(`Kommo: ${kommo.base}\n`);

  // ---------- catálogos ----------
  console.log('Catálogos:');
  const conta = await kommo.get('/api/v4/account');
  const usuarios = await kommo.listarTudo('/api/v4/users', 'users', { rotulo: 'usuários' });
  const funis = await kommo.listarTudo('/api/v4/leads/pipelines', 'pipelines', {
    rotulo: 'funis',
  });
  const camposDeLead = await kommo.listarTudo(
    '/api/v4/leads/custom_fields',
    'custom_fields',
    { rotulo: 'campos de lead' },
  );
  const camposDeContato = await kommo.listarTudo(
    '/api/v4/contacts/custom_fields',
    'custom_fields',
    { rotulo: 'campos de contato' },
  );

  // ---------- entidades ----------
  console.log('\nEntidades:');
  const leads = await kommo.listarTudo('/api/v4/leads?with=contacts', 'leads', {
    rotulo: 'leads',
  });
  const contatos = await kommo.listarTudo('/api/v4/contacts', 'contacts', {
    rotulo: 'contatos',
  });
  const empresas = await kommo.listarTudo('/api/v4/companies', 'companies', {
    rotulo: 'empresas',
  });

  // ---------- anotações ----------
  console.log('\nAnotações:');
  const notasDeLead = await kommo.listarTudo('/api/v4/leads/notes', 'notes', {
    rotulo: 'notas de lead',
  });
  const notasDeContato = await kommo.listarTudo('/api/v4/contacts/notes', 'notes', {
    rotulo: 'notas de contato',
  });

  // ============================================================
  // Análise
  // ============================================================

  // --- telefones: a trava dura do CB CRM ---
  const semTelefone = [];
  const porTelefone = new Map(); // normalizado → [ids de contato]
  let comMaisDeUmTelefone = 0;
  let comEmail = 0;
  let comEmpresa = 0;

  for (const c of contatos) {
    const telefones = valoresDoCampo(c, 'PHONE');
    const emails = valoresDoCampo(c, 'EMAIL');
    if (emails.length) comEmail++;
    if (c._embedded?.companies?.length) comEmpresa++;

    if (telefones.length === 0) {
      semTelefone.push({ id: c.id, nome: c.name ?? null });
      continue;
    }
    if (telefones.length > 1) comMaisDeUmTelefone++;

    // Só o PRIMEIRO telefone entra na conta de duplicata: é o que viraria
    // `contacts.phone`. Os demais não têm coluna e viram campo ou nada.
    const chave = normalizarTelefone(telefones[0]);
    if (!chave) {
      semTelefone.push({ id: c.id, nome: c.name ?? null, bruto: telefones[0] });
      continue;
    }
    if (!porTelefone.has(chave)) porTelefone.set(chave, []);
    porTelefone.get(chave).push({ id: c.id, nome: c.name ?? null });
  }

  const duplicados = [...porTelefone.entries()].filter(([, l]) => l.length > 1);
  const contatosEmDuplicata = duplicados.reduce((s, [, l]) => s + l.length, 0);

  // Telefone que não vira E.164 plausível. O CB CRM guarda só dígitos, mas a
  // API pública exige E.164 válido — e número curto demais é quase sempre
  // ramal ou lixo, não celular.
  const telefonesCurtos = [...porTelefone.keys()].filter((t) => t.length < 10);
  const semDDI55 = [...porTelefone.keys()].filter((t) => !t.startsWith('55'));

  // --- leads ---
  // ⚠️ A etapa da Kommo é o PAR (funil, etapa), como em `cruzamento.mjs` e
  // `src/lib/migracao/de-para.ts`: os ids 142 (ganho) e 143 (perdido)
  // existem em TODO funil. Chaveando só pelo status, todo lead ganho ou
  // perdido era contado no funil que o laço visitou por último (Codex,
  // PR #232).
  const etapaPorId = new Map();
  for (const f of funis) {
    for (const s of f._embedded?.statuses ?? []) {
      etapaPorId.set(`${f.id}:${s.id}`, { funil: f.name, etapa: s.name });
    }
  }

  const leadsPorEtapa = new Map();
  let leadsComValor = 0;
  let somaValores = 0;
  let leadsSemContato = 0;
  let leadsComVariosContatos = 0;

  for (const l of leads) {
    const e = etapaPorId.get(`${l.pipeline_id}:${l.status_id}`);
    const rotulo = e ? `${e.funil} › ${e.etapa}` : `(etapa ${l.status_id})`;
    leadsPorEtapa.set(rotulo, (leadsPorEtapa.get(rotulo) ?? 0) + 1);

    const preco = Number(l.price ?? 0);
    if (preco > 0) {
      leadsComValor++;
      somaValores += preco;
    }

    const vinculados = l._embedded?.contacts ?? [];
    if (vinculados.length === 0) leadsSemContato++;
    if (vinculados.length > 1) leadsComVariosContatos++;
  }

  // --- tags (vêm embutidas; não há endpoint de contagem de uso) ---
  const tagsDeLead = new Map();
  const tagsDeContato = new Map();
  for (const l of leads) {
    for (const t of l._embedded?.tags ?? []) {
      tagsDeLead.set(t.name, (tagsDeLead.get(t.name) ?? 0) + 1);
    }
  }
  for (const c of contatos) {
    for (const t of c._embedded?.tags ?? []) {
      tagsDeContato.set(t.name, (tagsDeContato.get(t.name) ?? 0) + 1);
    }
  }

  // --- preenchimento dos campos personalizados ---
  function preenchimento(entidades, catalogo) {
    const usados = new Map();
    for (const e of entidades) {
      for (const cv of e.custom_fields_values ?? []) {
        const temValor = (cv.values ?? []).some(
          (v) => v?.value != null && String(v.value).trim() !== '',
        );
        if (temValor) usados.set(cv.field_id, (usados.get(cv.field_id) ?? 0) + 1);
      }
    }
    return catalogo
      .map((c) => ({
        id: c.id,
        nome: c.name,
        tipo: c.type,
        codigo: c.code ?? null,
        preenchidos: usados.get(c.id) ?? 0,
      }))
      .sort((a, b) => b.preenchidos - a.preenchidos);
  }

  const usoCamposLead = preenchimento(leads, camposDeLead);
  const usoCamposContato = preenchimento(contatos, camposDeContato);

  // --- notas por tipo ---
  function porTipo(notas) {
    const m = new Map();
    for (const n of notas) m.set(n.note_type, (m.get(n.note_type) ?? 0) + 1);
    return ranking(m);
  }
  const tiposNotaLead = porTipo(notasDeLead);
  const tiposNotaContato = porTipo(notasDeContato);

  // Só a nota `common` é texto escrito por gente; o resto é registro de
  // chamada/SMS/mensagem de sistema e não é o que se quer migrar.
  const comuns = (n) => n.filter((x) => x.note_type === 'common').length;

  // Anotação no CB CRM exige conversa, e a conversa nasce do contato. Nota
  // de LEAD sem contato vinculado não teria onde pousar de jeito nenhum.
  const contatosDoLead = new Map(leads.map((l) => [l.id, l._embedded?.contacts ?? []]));
  const notasDeLeadOrfas = notasDeLead.filter(
    (n) => n.note_type === 'common' && (contatosDoLead.get(n.entity_id) ?? []).length === 0,
  ).length;

  // ============================================================
  // Saída
  // ============================================================
  fs.mkdirSync(PASTA_SAIDA, { recursive: true });

  const bruto = {
    gerado_em: new Date().toISOString(),
    conta,
    usuarios,
    funis,
    campos_de_lead: camposDeLead,
    campos_de_contato: camposDeContato,
    leads,
    contatos,
    empresas,
    notas_de_lead: notasDeLead,
    notas_de_contato: notasDeContato,
  };
  const arquivoBruto = path.join(PASTA_SAIDA, 'kommo-bruto.json');
  fs.writeFileSync(arquivoBruto, JSON.stringify(bruto, null, 2));

  const L = [];
  L.push(`# Levantamento Kommo → CB CRM`);
  L.push('');
  L.push(`Conta **${conta.name}** (\`${conta.subdomain}\`, id ${conta.id}) · moeda ${conta.currency} · ${usuarios.length} usuário(s)`);
  L.push(`Gerado em ${new Date().toLocaleString('pt-BR')} · somente leitura, nada foi alterado.`);
  L.push('');

  L.push('## Volume');
  L.push('');
  L.push('| Entidade | Total |');
  L.push('| --- | ---: |');
  L.push(`| Leads | ${leads.length} |`);
  L.push(`| Contatos | ${contatos.length} |`);
  L.push(`| Empresas | ${empresas.length} |`);
  L.push(`| Anotações de lead (todas) | ${notasDeLead.length} |`);
  L.push(`| ↳ de texto (\`common\`) | ${comuns(notasDeLead)} |`);
  L.push(`| Anotações de contato (todas) | ${notasDeContato.length} |`);
  L.push(`| ↳ de texto (\`common\`) | ${comuns(notasDeContato)} |`);
  L.push('');

  L.push('## Telefone — a trava dura do CB CRM');
  L.push('');
  L.push('`contacts` exige telefone OU Instagram (989) e o índice único `(account_id, phone_normalized)` (migration 022) funde contatos cujo telefone, só com dígitos, seja igual. Contagem com dígitos crus — a do nono dígito sai do `cruzamento.mjs`.');
  L.push('');
  L.push('| Situação | Contatos | % |');
  L.push('| --- | ---: | ---: |');
  L.push(`| Com telefone aproveitável | ${porTelefone.size + contatosEmDuplicata - duplicados.length} | ${pct(contatos.length - semTelefone.length, contatos.length)} |`);
  L.push(`| **Sem telefone** (não migram como contato) | ${semTelefone.length} | ${pct(semTelefone.length, contatos.length)} |`);
  L.push(`| Com mais de um telefone | ${comMaisDeUmTelefone} | ${pct(comMaisDeUmTelefone, contatos.length)} |`);
  L.push(`| Envolvidos em telefone duplicado | ${contatosEmDuplicata} (em ${duplicados.length} número(s)) | ${pct(contatosEmDuplicata, contatos.length)} |`);
  L.push(`| Telefone com menos de 10 dígitos | ${telefonesCurtos.length} | — |`);
  L.push(`| Telefone que não começa com 55 | ${semDDI55.length} | — |`);
  L.push(`| **Contatos distintos após a fusão** | **${porTelefone.size}** | — |`);
  L.push('');
  if (duplicados.length) {
    L.push('<details><summary>Primeiros 20 telefones duplicados</summary>');
    L.push('');
    for (const [tel, lista] of duplicados.slice(0, 20)) {
      L.push(`- \`${tel}\` → ${lista.map((c) => `${c.nome ?? '(sem nome)'} (#${c.id})`).join(' · ')}`);
    }
    L.push('');
    L.push('</details>');
    L.push('');
  }

  L.push('## Funis e etapas');
  L.push('');
  for (const f of funis) {
    L.push(`**${f.name}**${f.is_main ? ' _(principal)_' : ''} — ${(f._embedded?.statuses ?? []).length} etapas`);
  }
  L.push('');
  L.push('| Funil › Etapa | Leads |');
  L.push('| --- | ---: |');
  for (const [rotulo, n] of ranking(leadsPorEtapa)) L.push(`| ${rotulo} | ${n} |`);
  L.push('');
  L.push(`Leads com valor > 0: **${leadsComValor}** · soma **${somaValores.toLocaleString('pt-BR', { style: 'currency', currency: conta.currency || 'BRL' })}**`);
  L.push(`Leads sem contato vinculado: **${leadsSemContato}** · com mais de um contato: **${leadsComVariosContatos}**`);
  L.push('');

  L.push('## Campos personalizados');
  L.push('');
  L.push('O CB CRM tem `text`, `datetime`, `select` e `number` (948) e **só em contato** — campo de lead precisa descer para o contato ou virar texto no negócio.');
  L.push('');
  L.push('### De contato');
  L.push('');
  L.push('| Campo | Tipo na Kommo | Preenchidos |');
  L.push('| --- | --- | ---: |');
  for (const c of usoCamposContato) L.push(`| ${c.nome} | \`${c.tipo}\`${c.codigo ? ` (${c.codigo})` : ''} | ${c.preenchidos} |`);
  L.push('');
  L.push('### De lead');
  L.push('');
  L.push('| Campo | Tipo na Kommo | Preenchidos |');
  L.push('| --- | --- | ---: |');
  for (const c of usoCamposLead) L.push(`| ${c.nome} | \`${c.tipo}\`${c.codigo ? ` (${c.codigo})` : ''} | ${c.preenchidos} |`);
  L.push('');

  L.push('## Tags');
  L.push('');
  L.push(`De contato: **${tagsDeContato.size}** distintas · de lead: **${tagsDeLead.size}** distintas.`);
  L.push('');
  L.push('| Tag | Em contatos | Em leads |');
  L.push('| --- | ---: | ---: |');
  const todasTags = new Set([...tagsDeContato.keys(), ...tagsDeLead.keys()]);
  for (const nome of [...todasTags].sort(
    (a, b) => (tagsDeContato.get(b) ?? 0) + (tagsDeLead.get(b) ?? 0) - ((tagsDeContato.get(a) ?? 0) + (tagsDeLead.get(a) ?? 0)),
  )) {
    L.push(`| ${nome} | ${tagsDeContato.get(nome) ?? 0} | ${tagsDeLead.get(nome) ?? 0} |`);
  }
  L.push('');

  L.push('## Anotações');
  L.push('');
  L.push('No CB CRM a anotação pendura numa **conversa** (`cb_conversation_notes.conversation_id` é `NOT NULL`, migration 918) — contato que nunca trocou mensagem não tem onde recebê-la.');
  L.push('');
  L.push('| Tipo | Em leads | Em contatos |');
  L.push('| --- | ---: | ---: |');
  const tipos = new Set([...tiposNotaLead.map((t) => t[0]), ...tiposNotaContato.map((t) => t[0])]);
  for (const t of tipos) {
    L.push(`| \`${t}\` | ${tiposNotaLead.find((x) => x[0] === t)?.[1] ?? 0} | ${tiposNotaContato.find((x) => x[0] === t)?.[1] ?? 0} |`);
  }
  L.push('');
  L.push(`Anotações de texto em lead **sem contato vinculado** (sem destino possível): **${notasDeLeadOrfas}**`);
  L.push('');

  const arquivoRelatorio = path.join(PASTA_SAIDA, 'relatorio.md');
  fs.writeFileSync(arquivoRelatorio, L.join('\n'));

  console.log(`\n✓ Relatório: ${arquivoRelatorio}`);
  console.log(`✓ Dado bruto: ${arquivoBruto} (contém dado de cliente — não versionar)`);
}

main().catch((err) => {
  console.error('\n✗ Levantamento falhou:', err.message);
  process.exitCode = 1;
});
