import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// A 1005 é a fonte da verdade da execução interrompida (PR #223). O que este
// pino cobra é a FORMA que já mordeu neste projeto três vezes: fechar o
// EXECUTE de função exige revogar de PUBLIC *e* dos papéis, e devolver ao
// service_role — que é quem chama.
const sql = fs.readFileSync(path.join(__dirname, '1005_cb_execucao_interrompida.sql'), 'utf8')

describe('1005 — execução interrompida', () => {
  it('as duas colunas e o CHECK do vocabulário', () => {
    expect(sql).toMatch(/add column if not exists interrompida_em timestamptz/)
    expect(sql).toMatch(/add column if not exists interrompida_por text/)
    for (const motivo of ['resposta', 'etapa', 'parar', 'passo', 'desativacao']) {
      expect(sql).toContain(`'${motivo}'`)
    }
  })

  it('⚠️ a função é fechada de PUBLIC, anon e authenticated, e devolvida ao service_role', () => {
    expect(sql).toMatch(/revoke execute on function public\.cb_estacionar_espera\([^)]*\)\s+from public, anon, authenticated;/)
    expect(sql).toMatch(/grant execute on function public\.cb_estacionar_espera\([^)]*\)\s+to service_role;/)
    // E a conferência mede o RESULTADO, nunca a intenção.
    expect(sql).toMatch(/has_function_privilege\('anon'/)
    expect(sql).toMatch(/has_function_privilege\('service_role'/)
  })

  it('a função trava o registro antes de decidir', () => {
    expect(sql).toMatch(/for update/)
    expect(sql).toMatch(/interrompida_em is not null/)
  })
})
