// ============================================================
// Toda variável que o SERVIDOR lê chega ao contêiner?
//
// O `docker-stack.yml` passa o ambiente por `environment:` EXPLÍCITO, sem
// `env_file`: o que estiver no `crm.env` e não estiver nessa lista nunca
// chega ao contêiner, sem erro nenhum. Foi assim com `META_APP_ID` até
// 22/09/2026 — modelo com cabeçalho de imagem no número oficial falhava
// mesmo com a variável no `crm.env` —, e com `ALLOWED_INVITE_HOSTS` e as
// duas `AI_*`, documentadas no `.env.local.example` e sem efeito em
// produção.
//
// É o irmão do `env-documentado.test.ts`: aquele cobra que o exemplo
// documente o que o código lê; este cobra que o stack repasse.
//
// ⚠️ `NEXT_PUBLIC_*` ficam de fora: são gravadas no BUILD (build-arg do
// `pipeline.yml`), e passá-las em runtime não tem efeito.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const FONTE = join(RAIZ, 'src')
const STACK = join(RAIZ, 'docker-stack.yml')

/** Lidas pelo próprio Next, nunca definidas pelo operador. */
const DO_FRAMEWORK = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL_URL'])

/** Só fazem sentido no computador de quem desenvolve, nunca em produção. */
const SO_DE_DESENVOLVIMENTO = new Set([
  // Simula o envio de modelo à Meta sem chamar a API (templates/submit).
  'WHATSAPP_TEMPLATES_DRY_RUN',
])

function arquivosDeCodigo(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosDeCodigo(caminho, saida)
    else if (/\.(ts|tsx|mts|cts)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho)
  }
  return saida
}

function lidasPeloServidor(): Set<string> {
  const nomes = new Set<string>()
  for (const arquivo of arquivosDeCodigo(FONTE)) {
    for (const m of readFileSync(arquivo, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const nome = m[1]
      if (DO_FRAMEWORK.has(nome) || SO_DE_DESENVOLVIMENTO.has(nome)) continue
      if (nome.startsWith('NEXT_PUBLIC_')) continue
      nomes.add(nome)
    }
  }
  return nomes
}

/** As chaves do `environment:` do serviço `crm` (o primeiro serviço). */
function repassadasAoCrm(): Set<string> {
  const linhas = readFileSync(STACK, 'utf8').split('\n')
  const inicioDoServico = linhas.findIndex((l) => /^ {2}crm:\s*$/.test(l))
  if (inicioDoServico < 0) return new Set()
  const nomes = new Set<string>()
  let dentro = false
  for (const linha of linhas.slice(inicioDoServico + 1)) {
    if (/^ {2}\S/.test(linha)) break // próximo serviço
    if (/^ {4}environment:\s*$/.test(linha)) {
      dentro = true
      continue
    }
    if (dentro) {
      if (/^ {4}\S/.test(linha)) break // outra chave do serviço
      const m = linha.match(/^ {6}([A-Z][A-Z0-9_]*):/)
      if (m) nomes.add(m[1])
    }
  }
  return nomes
}

describe('docker-stack.yml', () => {
  it('repassa ao contêiner toda variável que o servidor lê', () => {
    const repassadas = repassadasAoCrm()
    const faltando = [...lidasPeloServidor()].filter((n) => !repassadas.has(n)).sort()
    expect(
      faltando,
      'Estas variáveis são lidas pelo servidor e não estão no `environment:` do serviço `crm` ' +
        'do docker-stack.yml — definidas no crm.env, nunca chegariam ao contêiner. Acrescente ' +
        '`NOME: ${NOME:-}` (e lembre que o stack só muda com `docker stack deploy` manual).',
    ).toEqual([])
  })

  it('a leitura do stack acha o serviço (cobertura, não só ausência de falta)', () => {
    const repassadas = repassadasAoCrm()
    expect(repassadas.has('SUPABASE_SERVICE_ROLE_KEY')).toBe(true)
    expect(repassadas.size).toBeGreaterThan(8)
    expect(lidasPeloServidor().size).toBeGreaterThan(8)
  })
})
