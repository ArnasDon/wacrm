import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { TITULO_SEM_NOME } from '@/lib/deals/titulo-do-card'
import path from 'node:path'

// O gatilho da 1007 renomeia o card de um jeito que nenhum teste de unidade
// alcança (ele mora no banco) e que nenhuma tela mostra até o dano estar
// feito. Este pino cobra as três cercas que decidem se ele ajuda ou destrói:
// a marca do título, a régua do nome escolhido e o recorte do card alvo.
const sql = fs.readFileSync(
  path.join(__dirname, '1007_cb_titulo_do_card_pelo_nome.sql'),
  'utf8',
)
const sql1008 = fs.readFileSync(
  path.join(__dirname, '1008_cb_titulo_de_reserva_nao_e_nome.sql'),
  'utf8',
)

describe('1007 — o título do card segue a ficha', () => {
  it('⚠️ o UPDATE do gatilho leva a cerca de título fixado', () => {
    // Sem ela, um título escrito à mão é apagado pela troca de apelido do
    // cliente no WhatsApp — e a trilha da 912 não guarda título, então
    // sumiria sem registro.
    expect(sql).toMatch(/UPDATE deals\s+SET title = v_nome\s+WHERE id = v_card\s+AND titulo_fixado_em IS NULL;/)
  })

  it('⚠️⚠️ título que JÁ tem nome só muda quando o nome novo foi ESCOLHIDO', () => {
    // A descoberta que inverteu o plano: 26 cards guardavam o nome do
    // contrato (Asaas) enquanto a ficha já tinha o apelido do WhatsApp.
    // Seguir a ficha sempre rebaixaria os 26.
    expect(sql).toMatch(
      /IF public\.cb_nome_para_titulo\(v_sufixo\) IS NOT NULL\s+AND NEW\.nome_fixado_em IS NULL THEN\s+RETURN NEW;/,
    )
  })

  it('o card alvo é o ABERTO mais recente, e só um', () => {
    expect(sql).toMatch(/AND status = 'open'\s+ORDER BY created_at DESC\s+LIMIT 1;/)
  })

  it('o gatilho só acorda quando o nome MUDOU', () => {
    expect(sql).toMatch(
      /AFTER UPDATE OF name ON public\.contacts\s+FOR EACH ROW\s+WHEN \(NEW\.name IS DISTINCT FROM OLD\.name\)/,
    )
  })

  it('o acervo do Asaas só toca ficha CRIADA por ele e sem nome escolhido', () => {
    // Ficha que já existia (ligada por telefone/CPF) tem o nome que o
    // escritório usa; carimbar o nome do contrato nela seria trocar o nome
    // que ninguém pediu para trocar.
    const acervo = sql.slice(sql.indexOf('Acervo A —'))
    expect(acervo).toMatch(/a\.vinculo_origem = 'criada'/)
    expect(acervo).toMatch(/c\.nome_fixado_em IS NULL/)
  })

  it("o acervo dos títulos preserva o nome do SUFIXO quando ele já é um nome", () => {
    // `COALESCE(sufixo, nome da ficha)` nesta ordem: invertido, os 26 nomes
    // de contrato viravam o apelido do WhatsApp.
    expect(sql).toMatch(
      /COALESCE\(\s*public\.cb_nome_para_titulo\(substr\(d\.title, position\(' — ' in d\.title\) \+ 3\)\),\s*public\.cb_nome_para_titulo\(c\.name\)\s*\)/,
    )
  })

  it('a conferência prova a régua do nome sem depender de dado (banco vazio)', () => {
    expect(sql).toMatch(/cb_nome_para_titulo\('558599704949'\) IS NOT NULL/)
    expect(sql).toMatch(/cb_nome_para_titulo\('\+55 \(85\) 99704-9490'\) IS NOT NULL/)
  })
})

describe('1008 — o rótulo de reserva não é nome de ninguém', () => {
  it('⚠️⚠️ o texto do gatilho é O MESMO de `TITULO_SEM_NOME`', () => {
    // O rótulo vive em dois lugares: o roteador o escreve em TS, o gatilho o
    // reconhece em SQL. Mudar um sem o outro devolve o defeito que a 1008
    // conserta — e em silêncio, porque o card só fica preso quando um nome
    // chega DEPOIS. Achado do Codex no PR #225.
    expect(sql1008).toContain(`<> '${TITULO_SEM_NOME}'`)
  })

  it('o gatilho troca o rótulo de reserva mesmo por nome que chegou sozinho', () => {
    // A cerca de "título que já tem nome" é o `AND` seguinte: o rótulo sai da
    // frente ANTES de ela decidir.
    const corpo = sql1008.slice(sql1008.indexOf('v_nome_no_titulo IS NOT NULL'))
    expect(corpo.slice(0, 200)).toMatch(
      /v_nome_no_titulo IS NOT NULL\s+AND v_nome_no_titulo <> 'Novo contato'\s+AND NEW\.nome_fixado_em IS NULL THEN/,
    )
  })

  it('quem DIGITOU o rótulo à mão continua protegido pela marca', () => {
    expect(sql1008).toMatch(/IF v_card IS NULL OR v_fixado IS NOT NULL/)
    expect(sql1008).toMatch(/AND titulo_fixado_em IS NULL;/)
  })

  it('a conferência mede o RESULTADO no catálogo, sem exigir dado', () => {
    expect(sql1008).toMatch(/pg_get_functiondef\('public\.cb_titulo_do_card_segue_a_ficha\(\)'::regprocedure\)/)
  })
})
