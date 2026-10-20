import fs from 'fs';

// Lê chaves do .env.local
const envContent = fs.readFileSync('C:\\Projetos\\WACRM\\.env.local', 'utf-8');
let tunnelKey = '';
let serviceKey = '';

for (const line of envContent.split(/\r?\n/)) {
  const tMatch = line.match(/^TUNNEL_API_KEY=(.*)$/);
  if (tMatch) tunnelKey = tMatch[1].trim().replace(/^["']|["']$/g, '');
  const sMatch = line.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/);
  if (sMatch) serviceKey = sMatch[1].trim().replace(/^["']|["']$/g, '');
}

console.log('==================================================');
console.log('TESTES DE SEGURANÇA E AUTENTICAÇÃO AO VIVO EM PRODUÇÃO');
console.log('==================================================');

async function run() {
  // Teste 1: Requisição sem header
  const r1 = await fetch('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log(`[PROD 01] Sem Header Authorization: HTTP ${r1.status} (Esperado: 401) -> ${r1.status === 401 ? 'PASS' : 'FAIL'}`);

  // Teste 2: Token incorreto
  const r2 = await fetch('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer chave_invalida_de_teste',
    },
    body: '{}',
  });
  console.log(`[PROD 02] Token Inválido: HTTP ${r2.status} (Esperado: 401) -> ${r2.status === 401 ? 'PASS' : 'FAIL'}`);

  // Teste 3: SUPABASE_SERVICE_ROLE_KEY (DEVE SER REJEITADA COM 401!)
  const r3 = await fetch('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: '{}',
  });
  console.log(`[PROD 03] SUPABASE_SERVICE_ROLE_KEY como token: HTTP ${r3.status} (Esperado: 401) -> ${r3.status === 401 ? 'PASS' : 'FAIL'}`);

  // Teste 4: TUNNEL_API_KEY dedicada (DEVE SER AUTENTICADA COM SUCESSO -> HTTP 400 por payload vazio e NÃO 401)
  const r4 = await fetch('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tunnelKey}`,
    },
    body: '{}',
  });
  console.log(`[PROD 04] TUNNEL_API_KEY dedicada direta: HTTP ${r4.status} (Esperado: 400) -> ${r4.status === 400 ? 'PASS' : 'FAIL'}`);

  // Teste 5: Proxy Vercel para WACRM (properties/sync)
  const r5 = await fetch('https://ronaldomeira.com.br/api/tunnel/v1/properties/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log(`[PROD 05] Proxy Vercel -> WACRM (properties/sync): HTTP ${r5.status} (Esperado: 400) -> ${r5.status === 400 ? 'PASS' : 'FAIL'}`);

  // Teste 6: Proxy Vercel para WACRM (events/tracking)
  const r6 = await fetch('https://ronaldomeira.com.br/api/tunnel/v1/events/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log(`[PROD 06] Proxy Vercel -> WACRM (events/tracking): HTTP ${r6.status} (Esperado: 400) -> ${r6.status === 400 ? 'PASS' : 'FAIL'}`);

  console.log('==================================================');
  const allPassed = r1.status === 401 && r2.status === 401 && r3.status === 401 && r4.status === 400 && r5.status === 400 && r6.status === 400;
  console.log(`VEREDITO DOS TESTES AO VIVO: ${allPassed ? '100% APROVADO' : 'FALHA DETECTADA'}`);
  console.log('==================================================');
}

run().catch(console.error);
