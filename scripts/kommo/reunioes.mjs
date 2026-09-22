// ============================================================
// Reuniões históricas da Kommo (decisão 27 do plano da migração, opção b).
//
// SÓ LEITURA. Este script não escreve nada — nem na Kommo, nem no Supabase.
// Lê o campo de LEAD "Reunião Marcada" (date_time), com "URL Reunião" e
// "Marcou reunião onde", e o contato principal de cada lead com os telefones
// dele, e grava tudo num JSON fora do repositório (é dado de CLIENTE).
// Quem liga cada reunião à ficha do CB CRM e grava em
// `cb_reunioes_da_kommo` (migration 1036) é um passo à parte, pela
// Management API, com conferência antes.
//
// ⚠️ Os campos são achados pelo NOME e o script ABORTA se algum faltar ou
// vier repetido — nunca por id adivinhado. É a regra da carga: um id errado
// não dá erro, só lê outro campo.
//
// ⚠️ A Kommo guarda UMA data por lead — a reunião remarcada sobrescreve a
// anterior. O que sai daqui é a última reunião de cada lead, não a série.
//
// Uso:
//   node scripts/kommo/reunioes.mjs --saida <arquivo.json>
// ============================================================

import fs from 'node:fs';

import { criarCliente, normalizarTelefone, valoresDoCampo } from './api.mjs';

const args = process.argv.slice(2);
const iSaida = args.indexOf('--saida');
const SAIDA = iSaida >= 0 ? args[iSaida + 1] : null;
if (!SAIDA) {
  console.error('Uso: node scripts/kommo/reunioes.mjs --saida <arquivo.json> (fora do repositório)');
  process.exit(1);
}

const CAMPOS = {
  data: 'Reunião Marcada',
  link: 'URL Reunião',
  onde: 'Marcou reunião onde',
};

/** O campo pelo nome exato, e só se houver UM com esse nome. */
function campoPeloNome(catalogo, nome) {
  const achados = catalogo.filter((c) => c.name === nome);
  if (achados.length !== 1) {
    throw new Error(`campo "${nome}": ${achados.length} com esse nome — esperado 1`);
  }
  return achados[0];
}

/** O primeiro valor preenchido de um campo do lead, pelo id. */
function valorDoCampo(entidade, id) {
  const campo = (entidade.custom_fields_values ?? []).find((c) => c.field_id === id);
  const v = (campo?.values ?? []).find((x) => x?.value != null && String(x.value).trim() !== '');
  return v ? v.value : null;
}

/**
 * `date_time` vem como segundos Unix. Aceita também o número em texto e,
 * por garantia, uma data ISO; qualquer outra coisa é `null` (a linha sai
 * contada como "data ilegível", nunca com a data de hoje).
 */
function instante(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number' || /^\d{9,11}$/.test(String(valor).trim())) {
    const s = Number(valor);
    return Number.isFinite(s) && s > 0 ? new Date(s * 1000) : null;
  }
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const kommo = criarCliente();
  console.log(`Kommo: ${kommo.base}\n`);

  const camposDeLead = await kommo.listarTudo('/api/v4/leads/custom_fields', 'custom_fields', {
    rotulo: 'campos de lead',
  });
  const campo = {
    data: campoPeloNome(camposDeLead, CAMPOS.data),
    link: campoPeloNome(camposDeLead, CAMPOS.link),
    onde: campoPeloNome(camposDeLead, CAMPOS.onde),
  };
  console.log(`  "${CAMPOS.data}" é do tipo ${campo.data.type}`);

  const leads = await kommo.listarTudo('/api/v4/leads?with=contacts', 'leads', { rotulo: 'leads' });
  const contatos = await kommo.listarTudo('/api/v4/contacts', 'contacts', { rotulo: 'contatos' });
  const telefonesDe = new Map(
    contatos.map((c) => [c.id, [...new Set(valoresDoCampo(c, 'PHONE').map(normalizarTelefone).filter(Boolean))]]),
  );

  const agora = Date.now();
  const conta = { leads: 0, com_data: 0, data_ilegivel: 0, passadas: 0, futuras: 0, sem_contato: 0, sem_telefone: 0 };
  const reunioes = [];
  for (const l of leads) {
    if (l.is_deleted) continue;
    conta.leads++;
    const bruto = valorDoCampo(l, campo.data.id);
    if (bruto == null) continue;
    conta.com_data++;
    const quando = instante(bruto);
    if (!quando) {
      conta.data_ilegivel++;
      continue;
    }
    if (quando.getTime() >= agora) {
      conta.futuras++;
      continue;
    }
    conta.passadas++;
    const vinculos = l._embedded?.contacts ?? [];
    const principal = vinculos.find((c) => c.is_main) ?? vinculos[0] ?? null;
    if (!principal) conta.sem_contato++;
    const telefones = principal ? telefonesDe.get(principal.id) ?? [] : [];
    if (principal && telefones.length === 0) conta.sem_telefone++;
    const link = valorDoCampo(l, campo.link.id);
    const onde = valorDoCampo(l, campo.onde.id);
    reunioes.push({
      kommo_lead_id: l.id,
      kommo_contato_id: principal?.id ?? null,
      telefones,
      reuniao_em: quando.toISOString(),
      link: link == null ? null : String(link).trim() || null,
      marcou_onde: onde == null ? null : String(onde).trim() || null,
      funil_kommo: l.pipeline_id ?? null,
      etapa_kommo: l.status_id ?? null,
    });
  }

  fs.writeFileSync(SAIDA, JSON.stringify({ lido_em: new Date(agora).toISOString(), reunioes }, null, 1));
  console.log('\n', conta);
  console.log(`\n${reunioes.length} reuniões passadas gravadas em ${SAIDA}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
