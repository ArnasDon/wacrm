import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// QUEM pode chamar o caminho NORMAL de ingestão da Evolution.
//
// `persistInboundMessage` e `persistDeviceMessage` não são "gravar uma
// mensagem": são o pacote inteiro — robô, automações, IA, funil, reabertura,
// canal da conversa, atraso de entrega, cancelamento de esperas. Quem os chama
// dispara TUDO isso por indireção, sem que nenhuma das outras allowlists da
// casa perceba (elas vigiam os motores, e o chamador novo não cita motor
// nenhum: cita só estas duas funções).
//
// Default-deny: arquivo novo que as chame reprova aqui até entrar na lista,
// por decisão visível no diff. (Nasceu com a 1009: `sem-telefone/entregar.ts`
// virou o primeiro chamador fora da rota — achado da revisão por duas lentes.)
// ============================================================

const SRC = path.join(__dirname, '..', '..');

const PERMITIDOS: Record<string, string> = {
  'lib/whatsapp/inbound-store.ts': 'a definição',
  'app/api/whatsapp/evolution/webhook/route.ts': 'a rota do webhook — o chamador de sempre',
  'lib/whatsapp/sem-telefone/entregar.ts':
    'mensagem recuperada sem telefone, SÓ no modo `nova` (ainda é a última da conversa e acabou de chegar)',
};

function semComentarios(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
}

function arquivosDeProducao(dir: string, achados: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosDeProducao(p, achados);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.test-helper\./.test(e.name)) achados.push(p);
  }
  return achados;
}

describe('caminho normal de ingestão: só quem está na lista o chama', () => {
  const citam = arquivosDeProducao(SRC)
    .filter((arquivo) => /\bpersist(Inbound|Device)Message\b/.test(semComentarios(fs.readFileSync(arquivo, 'utf8'))))
    .map((arquivo) => path.relative(SRC, arquivo).split(path.sep).join('/'))
    .sort();

  it('o conjunto de chamadores é EXATAMENTE o permitido', () => {
    expect(citam).toEqual(Object.keys(PERMITIDOS).sort());
  });

  it('a recuperada só chega ao caminho normal pelo modo `nova`', () => {
    const f = semComentarios(
      fs.readFileSync(path.join(SRC, 'lib/whatsapp/sem-telefone/entregar.ts'), 'utf8'),
    );
    // Tudo que não é `nova` sai ANTES das duas chamadas.
    const saida = f.indexOf("if (modo !== 'nova')");
    const chamada = f.search(/await persist(Device|Inbound)Message\(/);
    expect(saida).toBeGreaterThan(-1);
    expect(chamada).toBeGreaterThan(saida);
    const bloco = f.slice(saida, chamada);
    expect(bloco).toMatch(/return\s/);
  });
});
