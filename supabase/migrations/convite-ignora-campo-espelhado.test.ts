import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Conta nova nasce com o campo "E-mail" espelhado (1000) — e o convite NÃO
// pode contar esse campo como "dado" da conta de quem aceita.
//
// `redeem_invitation` recusa quem tenta entrar numa conta tendo dados na
// própria ("Your account already contains data"), e `custom_fields` está na
// lista. O gatilho `cb_semeia_campo_de_email` põe o campo em TODA conta nova —
// a provisória do cadastro e a que `remove_account_member` cria —, então sem
// o `espelho IS NULL` naquela linha TODO convite seria recusado com 409, e
// trocar de e-mail não resolveria. Achado da revisão do PR #210 antes de
// aplicar; medido num Postgres descartável (o mutante reproduz a recusa).
//
// Por que um teste: a função já foi recriada TRÊS vezes (0019, 0922, 0960) e
// cada recriação reescreve o corpo inteiro. A próxima — nossa ou num merge do
// upstream, que tem a sua 019 — pode trazer a linha crua de volta, e nada
// estoura até alguém tentar entrar na conta do escritório.
// ============================================================

const DIR = __dirname;
const arquivos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** O corpo da ÚLTIMA definição de `redeem_invitation`, pela ordem do replay. */
function ultimaDefinicao(): { arquivo: string; corpo: string } | null {
  let achada: { arquivo: string; corpo: string } | null = null;
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    const re = /CREATE OR REPLACE FUNCTION public\.redeem_invitation\([\s\S]*?\$function\$;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) achada = { arquivo, corpo: m[0] };
  }
  return achada;
}

describe('convite × campo espelhado (1000)', () => {
  const semeia = arquivos.some((f) =>
    /cb_semeia_campo_de_email/.test(fs.readFileSync(path.join(DIR, f), 'utf8'))
  );

  it('CRÍTICO: a última redeem_invitation ignora o campo espelhado na checagem de dados', () => {
    expect(semeia).toBe(true);
    const ultima = ultimaDefinicao();
    expect(ultima).not.toBeNull();
    const linhaDosCampos = ultima!.corpo
      .split('\n')
      .find((l) => /FROM custom_fields/.test(l) && !/^\s*--/.test(l));
    // Quem reprovar aqui: a linha de `custom_fields` precisa de
    // `AND espelho IS NULL`, senão toda conta nova (que nasce com o campo)
    // é recusada no convite.
    expect(linhaDosCampos, `em ${ultima!.arquivo}`).toMatch(/espelho IS NULL/);
  });

  it('a última definição vem DEPOIS da migration que semeia o campo', () => {
    const ultima = ultimaDefinicao();
    const semeadora = arquivos.find((f) =>
      /CREATE TRIGGER cb_semeia_campo_de_email_trigger/.test(
        fs.readFileSync(path.join(DIR, f), 'utf8')
      )
    );
    expect(semeadora).toBeDefined();
    expect(ultima!.arquivo >= semeadora!).toBe(true);
  });
});
