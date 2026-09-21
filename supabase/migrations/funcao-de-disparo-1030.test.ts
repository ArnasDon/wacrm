import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// `create_broadcast_with_recipients` passou três migrations (0040, 0041, 0940)
// sem NUNCA ter conseguido executar, e tinha DOIS defeitos:
//
//  1. `RETURNING id, contact_id` cru é ambíguo com a coluna de saída do
//     RETURNS TABLE (42702 na primeira execução). O plpgsql só resolve nomes
//     quando a instrução RODA — aplicar limpo não prova nada. O upstream
//     consertou isto (#536), para a assinatura de OITO parâmetros.
//  2. `p_template_params JSONB[]`: pelo PostgREST, o `string[][]` do app vira um
//     array de DUAS dimensões. Com 2+ variáveis a função grava o DOBRO de
//     linhas (metade SEM contato, o 2º contato com o parâmetro do 1º) e a
//     campanha fica órfã em `sending`; com 1, grava texto em vez de lista e o
//     "retomar" reenvia sem as variáveis. O upstream NÃO consertou — achado da revisão da Fase 2 do
//     docs/PLANO-merge-upstream-2026-09.md, medido num Postgres 16.
//
// A 1030 conserta os dois na assinatura de NOVE parâmetros (a nossa, com o
// canal). O que este pino cobra é o que um merge do upstream desfaz SEM
// conflito: a 041 deles recria a de oito, que a 0940 apagou de propósito — com
// as duas de pé, uma chamada sem o canal cai na que não carimba
// `broadcasts.channel_id`.
const dir = __dirname
const NOME = 'create_broadcast_with_recipients'

/** O que fazer quando este pino reprova num merge do upstream. */
const O_QUE_FAZER =
  'Se o arquivo é a 041_fix_broadcast_contact_id_ambiguity do upstream: APAGUE-o, não renomeie — ' +
  'CLAUDE.md, "Workflow de migrations" (a exceção da 041). Migration NOSSA nova que redefina a função ' +
  'entra na lista do primeiro teste e tem de manter a forma final (9 parâmetros, p_template_params JSONB).'

interface Definicao {
  arquivo: string
  parametros: string[]
  corpo: string
}

/** Parte a lista de argumentos nas vírgulas de NÍVEL ZERO (`numeric(10,2)` é um só). */
function partirArgumentos(lista: string): string[] {
  const partes: string[] = []
  let nivel = 0
  let atual = ''
  for (const ch of lista) {
    if (ch === '(') nivel++
    if (ch === ')') nivel--
    if (ch === ',' && nivel === 0) {
      partes.push(atual.trim())
      atual = ''
    } else atual += ch
  }
  if (atual.trim()) partes.push(atual.trim())
  return partes
}

/**
 * Toda definição da função, em TODO arquivo .sql da pasta (inclusive um de três
 * dígitos que tenha escapado do merge), em ordem de aplicação.
 *
 * ⚠️ O casamento é frouxo de propósito: com ou sem `OR REPLACE`, com ou sem
 * `public.`, com aspas no schema ou no nome. A primeira versão exigia
 * `CREATE OR REPLACE FUNCTION public.` e a Lente 1 mostrou as quatro grafias
 * que passavam por ela sem serem vistas.
 */
function definicoes(): Definicao[] {
  const abre = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\s*\\.\\s*)?"?${NOME}"?\\s*\\(`,
    'gi',
  )
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((arquivo) => {
      const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8')
      const achadas: Definicao[] = []
      for (const m of sql.matchAll(abre)) {
        const inicio = m.index! + m[0].length
        let nivel = 1
        let i = inicio
        for (; i < sql.length && nivel > 0; i++) {
          if (sql[i] === '(') nivel++
          if (sql[i] === ')') nivel--
        }
        const resto = sql.slice(i)
        const proxima = resto.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i)
        achadas.push({
          arquivo,
          parametros: partirArgumentos(sql.slice(inicio, i - 1)),
          corpo: proxima === -1 ? resto : resto.slice(0, proxima),
        })
      }
      return achadas
    })
}

describe('1030 — a função de disparo executa, grava os params como lista, e só existe UMA', () => {
  it('o leitor enxerga as quatro definições reais, com a contagem certa', () => {
    expect(definicoes().map((d) => [d.arquivo, d.parametros.length]), O_QUE_FAZER).toEqual([
      ['0040_webhook_broadcast_reliability.sql', 7],
      ['0041_broadcast_resume.sql', 8],
      ['0940_cb_broadcast_com_canal.sql', 9],
      ['1030_cb_funcao_de_disparo_executavel.sql', 9],
    ])
  })

  it('⚠️ a ÚLTIMA definição tem o RETURNING qualificado — e não o cru', () => {
    // ⚠️ Só o corpo da FUNÇÃO (até o primeiro `$$;`): o bloco de conferência
    // cita a forma certa num LIKE, e a asserção positiva casaria com ELE mesmo
    // se a função voltasse a ter o RETURNING cru (achado da Lente 1).
    const funcao = definicoes().at(-1)!.corpo.split('$$;')[0]
    expect(funcao).toMatch(/RETURNING\s+id,\s*broadcast_recipients\.contact_id/)
    // A forma crua é o defeito 1 inteiro (SQLSTATE 42702 na primeira execução).
    expect(funcao).not.toMatch(/RETURNING\s+id,\s*contact_id/)
  })

  it('⚠️ a ÚLTIMA definição recebe os params como JSONB (não JSONB[]) e pareia por ORDINALIDADE', () => {
    const ultima = definicoes().at(-1)!
    const params = ultima.parametros.find((p) => /^p_template_params\b/i.test(p))
    expect(params, 'p_template_params sumiu da assinatura').toBeDefined()
    // `JSONB[]` é o defeito 2: pelo PostgREST vira um array de DUAS dimensões.
    expect(params).toMatch(/^p_template_params\s+JSONB$/i)
    expect(ultima.parametros.at(-1)).toMatch(/^p_channel_id\s+UUID$/i)
    const funcao = ultima.corpo.split('$$;')[0]
    expect(funcao).toMatch(/unnest\(p_contact_ids\)\s+WITH\s+ORDINALITY/i)
    expect(funcao).toMatch(/jsonb_array_elements\([\s\S]*?\)\s+WITH\s+ORDINALITY/i)
    // ⚠️ É o `USING (ord)` que amarra cada contato à SUA lista. Trocado por
    // `ON true` (mutante medido), 2 contatos × 2 listas viram 4 linhas — e só a
    // conferência da 1030, com dois contatos, percebia.
    expect(funcao).toMatch(/WITH\s+ORDINALITY\s+AS\s+p\(prm,\s*ord\)\s+USING\s*\(ord\)/i)
    // O pareamento antigo (unnest de DOIS arrays) é o que espalhava os params.
    expect(funcao).not.toMatch(/unnest\(\s*p_contact_ids\s*,\s*p_template_params\s*\)/i)
  })

  it('⚠️ fora das três históricas, NENHUM arquivo cria outra assinatura', () => {
    // 0040 (sete), 0041 (oito) e 0940 (nove, com JSONB[]) são história: cada uma
    // apaga a anterior, e a 1030 apaga a da 0940. Todo o resto só pode
    // (re)definir a forma final.
    //
    // ⚠️ A régua é pelo ARQUIVO, não pela posição: a 041 do upstream renomeada
    // para `0044_…` ordenaria ANTES da 0940 e o replay terminaria certo (a 0940
    // apaga a de oito) — mas a produção aplica por ordem CRONOLÓGICA, e lá ela
    // rodaria depois, deixando o overload de pé.
    const HISTORICAS = new Set([
      '0040_webhook_broadcast_reliability.sql',
      '0041_broadcast_resume.sql',
      '0940_cb_broadcast_com_canal.sql',
    ])
    for (const d of definicoes().filter((x) => !HISTORICAS.has(x.arquivo))) {
      const aviso = `${d.arquivo} define ${NOME}(${d.parametros.length} parâmetros). ${O_QUE_FAZER}`
      expect(d.parametros.length, aviso).toBe(9)
      expect(
        d.parametros.some((p) => /^p_template_params\s+JSONB$/i.test(p)),
        `${d.arquivo}: p_template_params tem de ser JSONB, não JSONB[]`,
      ).toBe(true)
    }
  })

  it('a 1030 APAGA as duas formas antigas, avisa o PostgREST e a conferência CHAMA a função', () => {
    const sql = fs.readFileSync(path.join(dir, '1030_cb_funcao_de_disparo_executavel.sql'), 'utf8')
    // Mudar o TIPO de um argumento cria outra assinatura: sem os DROPs a
    // quebrada ficaria de pé ao lado da nova.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.create_broadcast_with_recipients\(\s*UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID\[\], JSONB\[\]\s*\);/)
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.create_broadcast_with_recipients\(\s*UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID\[\], JSONB\[\], UUID\s*\);/)
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
    expect(sql).toMatch(/IF v_quantas <> 1 THEN/)
    // Pelo caminho do PostgREST, e em DUAS instruções (dentro da mesma, a
    // consulta de fora não enxerga a linha que a função acabou de inserir).
    expect(sql).toMatch(/FROM json_to_record\(v_corpo\) AS _\(c UUID\[\], p JSONB\)/)
    expect(sql).toMatch(/SELECT f\.broadcast_id INTO v_campanha/)
    expect(sql).toMatch(/WHERE r\.broadcast_id = v_campanha/)
    // Com DOIS contatos e listas de tamanhos diferentes — é o que prova o pareamento.
    expect(sql).toMatch(/WHEN 2 THEN '\[\["a","b"\],\["c"\]\]'::json/)
    // Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a chamada existe para mostrar.
    expect(sql).toMatch(/WHEN SQLSTATE 'P1030' THEN/)
    expect(sql).not.toMatch(/WHEN OTHERS THEN/)
    // As duas metades do REVOKE e o GRANT de volta (regra do banco vazio).
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[^;]+FROM PUBLIC, anon, authenticated;/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[^;]+TO service_role;/)
  })

  it('o verify-schema do CI confere a assinatura FINAL, sem estourar no cast', () => {
    const verify = fs.readFileSync(path.join(dir, '..', 'ci', 'verify-schema.sql'), 'utf8')
    expect(verify).toMatch(
      /to_regprocedure\(\s*'public\.create_broadcast_with_recipients\(uuid,uuid,text,text,text,integer,uuid\[\],jsonb,uuid\)'/,
    )
    // A forma do upstream faz `::regprocedure` na de OITO — no nosso replay ela
    // não existe, o cast estoura e o deploy trava.
    expect(verify).not.toMatch(/create_broadcast_with_recipients\([^)]*jsonb\[\]\)'::regprocedure/)
    // O arquivo tem de continuar com UMA instrução (`supabase db query --file`).
    expect(verify.match(/^DO \$\$/gm)?.length).toBe(1)
  })

  it('o app manda os params como lista de listas, e por NOME — a troca de tipo não pede edição', () => {
    const nucleo = fs.readFileSync(
      path.join(dir, '..', '..', 'src', 'lib', 'whatsapp', 'broadcast-core.ts'),
      'utf8',
    )
    expect(nucleo).toMatch(/p_template_params:\s*deduped\.map\(\(r\)\s*=>\s*r\.params\)/)
    expect(nucleo).toMatch(/p_channel_id:\s*canal\.channelId/)
  })
})
