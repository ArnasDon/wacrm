/**
 * Script para traduzir os nomes das etapas do funil de inglês para português.
 * Executa uma única vez para atualizar registros já existentes no banco de dados.
 *
 * Uso: node scripts/translate-stages.mjs
 */

const SUPABASE_URL = 'https://pachwrzixegzukdqsqob.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhY2h3cnppeGVnenVrZHFzcW9iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTQ4NjM2MywiZXhwIjoyMDk1MDYyMzYzfQ.-u209f38igEQTa6P3gLIuxF_WhmVrzAXGtGN2ykhi4c';

// Mapeamento de nome em inglês → nome em português
const NAME_MAP = {
  'New Lead':       'Novo Lead',
  'Qualified':      'Qualificado',
  'Proposal Sent':  'Proposta Enviada',
  'Negotiation':    'Negociação',
  'Won':            'Ganho',
  // Variações adicionais que podem existir
  'Lead':           'Lead',
  'Lost':           'Perdido',
  'Closed':         'Fechado',
};

async function run() {
  // 1. Buscar todas as etapas
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages?select=id,name`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!listRes.ok) {
    console.error('Falha ao buscar etapas:', await listRes.text());
    process.exit(1);
  }

  const stages = await listRes.json();
  console.log(`\n📋 ${stages.length} etapa(s) encontrada(s):\n`);

  let updated = 0;
  let skipped = 0;

  for (const stage of stages) {
    const newName = NAME_MAP[stage.name];

    if (!newName || newName === stage.name) {
      console.log(`  ⏭  Ignorado: "${stage.name}" (sem tradução ou já em pt-BR)`);
      skipped++;
      continue;
    }

    // 2. Atualizar o nome
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages?id=eq.${stage.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ name: newName }),
    });

    if (updateRes.ok) {
      console.log(`  ✅ "${stage.name}" → "${newName}"`);
      updated++;
    } else {
      console.error(`  ❌ Falha ao atualizar "${stage.name}":`, await updateRes.text());
    }
  }

  console.log(`\n🏁 Concluído: ${updated} atualizada(s), ${skipped} ignorada(s).\n`);
}

run().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
