import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { API_KEY_PREFIX } from '@/lib/api-keys/keys';
import { lerMudancaDeTags } from '@/lib/api/v1/tags-do-contato';
import { MAX_LIMIT } from '@/lib/api/v1/pagination';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { DELIVERY_TIMEOUT_MS, MAX_CONSECUTIVE_FAILURES } from '@/lib/webhooks/deliver';
import { WEBHOOK_SECRET_PREFIX } from '@/lib/webhooks/endpoints';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events';
import { exemploDeEnvelope } from '@/lib/webhooks/exemplos';
import { buildSignatureHeader, verifySignatureHeader } from '@/lib/webhooks/sign';

import {
  CABECALHO_DA_ASSINATURA,
  CABECALHO_DO_ENDERECO,
  CABECALHO_DO_EVENTO,
  FALHAS_QUE_DESLIGAM,
  INTERVALO_ENTRE_PAGINAS_MS,
  LIMITE_POR_MINUTO,
  PRAZO_DA_ENTREGA_SEGUNDOS,
  PREFIXO_DA_CHAVE,
  PREFIXO_DO_SEGREDO,
  TAMANHO_MAXIMO_DA_PAGINA,
  TOLERANCIA_DA_ASSINATURA_SEGUNDOS,
  assinaturaNoMake,
  assinaturaNoN8n,
  chaveNoMake,
  codigoDoN8n,
  credencialDoN8n,
  curlAplicarEtiqueta,
  curlCriarNegocio,
  curlDoMe,
  curlDosFunis,
  curlMandarMensagem,
  curlPreencherCampo,
  filtroDeEtapaNoN8n,
  jsonDoEvento,
  paginacaoDoN8n,
  type Marcadores,
  urlBaseDoCrm,
} from './exemplos-de-requisicao';

// ============================================================
// O módulo de exemplos roda no NAVEGADOR e por isso não pode importar os
// módulos de servidor que guardam os números de verdade. Este teste roda
// em Node e pode: cada constante espelhada é amarrada à sua fonte. Mudou o
// limite no servidor sem mudar aqui → a tela afirmaria um número falso, e
// é este teste que reprova.
// ============================================================

const M: Marcadores = {
  chave: 'SUA_CHAVE',
  idDoContato: 'ID_DO_CONTATO',
  idDoFunil: 'ID_DO_FUNIL',
  idDaEtapa: 'ID_DA_ETAPA',
  idDaConexao: 'ID_DA_CONEXAO',
  segredo: 'SEU_SEGREDO',
  tituloDoNegocio: 'Maria Exemplo',
  // Com apóstrofo de propósito: é o caso que quebraria o `-d '…'`.
  textoDaMensagem: "Hi! We've got your message.",
};

const BASE = 'https://crm.exemplo.com.br';

/** Tira o corpo de um curl (`-d '…'`), desfazendo o escape de shell. */
function corpoDoCurl(trecho: string): unknown {
  const i = trecho.indexOf("-d '");
  expect(i).toBeGreaterThan(-1);
  const cru = trecho.slice(i + 4, trecho.lastIndexOf("'"));
  return JSON.parse(cru.replace(/'\\''/g, "'"));
}

describe('constantes espelhadas: amarradas à fonte de servidor', () => {
  it('prefixo da chave de API', () => {
    expect(PREFIXO_DA_CHAVE).toBe(API_KEY_PREFIX);
  });

  it('prefixo do segredo do webhook enviado', () => {
    expect(PREFIXO_DO_SEGREDO).toBe(WEBHOOK_SECRET_PREFIX);
  });

  it('limite por minuto da API pública (janela de UM minuto)', () => {
    expect(RATE_LIMITS.publicApi.windowMs).toBe(60_000);
    expect(LIMITE_POR_MINUTO).toBe(RATE_LIMITS.publicApi.limit);
  });

  it('tamanho máximo da página', () => {
    expect(TAMANHO_MAXIMO_DA_PAGINA).toBe(MAX_LIMIT);
  });

  it('prazo da entrega e falhas que desligam', () => {
    expect(PRAZO_DA_ENTREGA_SEGUNDOS * 1000).toBe(DELIVERY_TIMEOUT_MS);
    expect(FALHAS_QUE_DESLIGAM).toBe(MAX_CONSECUTIVE_FAILURES);
  });

  it('os três cabeçalhos estão, como string literal, no código que entrega', () => {
    // Lido do FONTE (o nome do cabeçalho não é exportado com nome estável):
    // basta que ele exista como literal entre aspas — em comentário ele
    // aparece entre crases, e não conta.
    const fonte = readFileSync('src/lib/webhooks/deliver.ts', 'utf8');
    for (const nome of [CABECALHO_DO_EVENTO, CABECALHO_DO_ENDERECO, CABECALHO_DA_ASSINATURA]) {
      expect(fonte).toMatch(new RegExp(`['"]${nome}['"]`));
    }
  });

  it('a janela contra replay é MEDIDA na verificação real do CRM', () => {
    const corpo = '{"a":1}';
    const t0 = 1_800_000_000;
    const cab = buildSignatureHeader(corpo, 'whsec_x', t0);
    expect(verifySignatureHeader(cab, corpo, 'whsec_x', t0 + TOLERANCIA_DA_ASSINATURA_SEGUNDOS)).toBe(true);
    expect(verifySignatureHeader(cab, corpo, 'whsec_x', t0 + TOLERANCIA_DA_ASSINATURA_SEGUNDOS + 1)).toBe(false);
  });

  it('o intervalo entre páginas cabe no limite por minuto', () => {
    expect(INTERVALO_ENTRE_PAGINAS_MS).toBeGreaterThanOrEqual(60_000 / LIMITE_POR_MINUTO);
    expect(paginacaoDoN8n()).toContain(`Interval Between Requests (ms): ${INTERVALO_ENTRE_PAGINAS_MS}`);
    expect(paginacaoDoN8n()).toContain(`limit = ${TAMANHO_MAXIMO_DA_PAGINA}`);
  });
});

describe('urlBaseDoCrm', () => {
  it('a URL do site vence a origem, sem barra no fim', () => {
    expect(urlBaseDoCrm(' https://crm.x.com/ ', 'http://localhost:3000')).toBe('https://crm.x.com');
  });
  it('sem a URL do site, a origem', () => {
    expect(urlBaseDoCrm(undefined, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(urlBaseDoCrm('', 'http://localhost:3000')).toBe('http://localhost:3000');
  });
  it('sem nenhuma das duas, null (nunca uma URL inventada)', () => {
    expect(urlBaseDoCrm(undefined, null)).toBeNull();
  });
});

describe('os curl', () => {
  it('toda chamada leva a URL base real e a chave no Authorization', () => {
    for (const trecho of [
      curlDoMe(BASE, M),
      curlDosFunis(BASE, M),
      curlCriarNegocio(BASE, M),
      curlAplicarEtiqueta(BASE, M),
      curlPreencherCampo(BASE, M),
      curlMandarMensagem(BASE, M),
    ]) {
      expect(trecho).toContain(`${BASE}/api/v1/`);
      expect(trecho).toContain('-H "Authorization: Bearer SUA_CHAVE"');
    }
  });

  it('GET não leva corpo nem -X', () => {
    expect(curlDoMe(BASE, M)).toBe(
      `curl ${BASE}/api/v1/me \\\n  -H "Authorization: Bearer SUA_CHAVE"`
    );
    expect(curlDosFunis(BASE, M)).not.toContain('-d ');
  });

  it('criar negócio: stage_id presente (a rota o exige)', () => {
    expect(corpoDoCurl(curlCriarNegocio(BASE, M))).toEqual({
      contact_id: 'ID_DO_CONTATO',
      pipeline_id: 'ID_DO_FUNIL',
      stage_id: 'ID_DA_ETAPA',
      title: 'Maria Exemplo',
    });
  });

  it('aplicar etiqueta: o corpo passa pelo parser REAL da rota', () => {
    const trecho = curlAplicarEtiqueta(BASE, M);
    expect(trecho).toContain('-X POST');
    expect(trecho).toContain('/api/v1/contacts/ID_DO_CONTATO/tags');
    expect(lerMudancaDeTags(corpoDoCurl(trecho)).ok).toBe(true);
  });

  it('preencher campo: PATCH com values por chave', () => {
    const trecho = curlPreencherCampo(BASE, M);
    expect(trecho).toContain('-X PATCH');
    expect(corpoDoCurl(trecho)).toEqual({ values: { utm_source: 'instagram' } });
  });

  it('mensagem com apóstrofo continua JSON válido depois do shell', () => {
    const corpo = corpoDoCurl(curlMandarMensagem(BASE, M)) as Record<string, unknown>;
    expect(corpo.text).toBe(M.textoDaMensagem);
    expect(corpo.to).toMatch(/^\+\d{12,13}$/);
    expect(corpo.channel_id).toBe('ID_DA_CONEXAO');
  });
});

describe('JSON dos eventos', () => {
  it.each([...WEBHOOK_EVENTS])('%s: é o envelope de exemplo, sem a marca de teste', (ev) => {
    const obj = JSON.parse(jsonDoEvento(ev));
    expect(obj).toEqual(exemploDeEnvelope(ev));
    expect(obj.event).toBe(ev);
    expect('test' in obj).toBe(false);
  });
});

describe('conferência da assinatura no n8n', () => {
  it('o nó Code, EXECUTADO, reproduz o v1 de buildSignatureHeader', async () => {
    // O corpo exatamente como o CRM manda: JSON compacto (deliver.ts).
    const corpo = JSON.stringify(exemploDeEnvelope('deal.stage_changed', { teste: true }));
    const segredo = `${WEBHOOK_SECRET_PREFIX}segredo_ficticio_de_teste`;
    const t = 1_800_000_123;
    const cabecalho = buildSignatureHeader(corpo, segredo, t);
    const v1 = cabecalho.split('v1=')[1];

    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
      ...args: string[]
    ) => (...a: unknown[]) => Promise<unknown>;
    const noCode = new AsyncFunction('$input', codigoDoN8n());
    const $input = {
      first: () => ({
        json: { headers: { [CABECALHO_DA_ASSINATURA.toLowerCase()]: cabecalho } },
      }),
    };
    const contexto = {
      helpers: {
        getBinaryDataBuffer: async (indice: number, propriedade: string) => {
          expect([indice, propriedade]).toEqual([0, 'data']);
          return Buffer.from(corpo, 'utf8');
        },
      },
    };
    const saida = (await noCode.call(contexto, $input)) as Array<{
      json: { message: string; v1: string; t: number; body: unknown };
    }>;
    const { json } = saida[0];

    // O que o nó Crypto faz com `message` e o segredo da credencial:
    const calculado = createHmac('sha256', segredo).update(json.message).digest('hex');
    expect(calculado).toBe(v1);
    expect(json.v1).toBe(v1);
    expect(json.t).toBe(t);
    expect(json.body).toEqual(JSON.parse(corpo));
  });

  it('a configuração cita o segredo, a janela e o campo que o Code produz', () => {
    const texto = assinaturaNoN8n(M);
    expect(texto).toContain('{{ $json.message }}');
    expect(texto).toContain('SEU_SEGREDO');
    expect(texto).toContain(`is less than  ${TOLERANCIA_DA_ASSINATURA_SEGUNDOS}`);
  });

  it('Make: lê o cabeçalho em minúsculas e usa o segredo como chave do sha256', () => {
    const texto = assinaturaNoMake(M);
    expect(texto).toContain(`"${CABECALHO_DA_ASSINATURA.toLowerCase()}"`);
    expect(texto).toContain('sha256(t + "." + 1.value; "hex"; "SEU_SEGREDO")');
  });

  it('Make: o Filter confere a JANELA de t, com a régua da verificação real nas bordas', () => {
    // Sem a janela, uma entrega capturada passaria reenviada a qualquer hora
    // (o HMAC do corpo reenviado é o mesmo). O trecho é texto para o operador
    // colar no Make, então o teste o LÊ: tira as duas comparações de `t`
    // contra `timestamp` e as avalia, e o resultado tem de coincidir com
    // `verifySignatureHeader` — inclusive exatamente na borda da janela.
    const texto = assinaturaNoMake(M);
    const comparacoes = [
      ...texto.matchAll(
        /AND t\s+Numeric: (Greater|Less) than or equal to\s+\{\{timestamp ([+-]) (\d+)\}\}/g
      ),
    ].map(([, sentido, sinal, n]) => ({
      sentido,
      deslocamento: (sinal === '-' ? -1 : 1) * Number(n),
    }));
    // Duas, uma para cada lado: o Make não tem `abs`.
    expect(comparacoes).toHaveLength(2);
    for (const c of comparacoes) {
      expect(Math.abs(c.deslocamento)).toBe(TOLERANCIA_DA_ASSINATURA_SEGUNDOS);
    }

    const filtroAceita = (t: number, agora: number) =>
      comparacoes.every(({ sentido, deslocamento }) =>
        sentido === 'Greater' ? t >= agora + deslocamento : t <= agora + deslocamento
      );

    const corpo = '{"a":1}';
    const t0 = 1_800_000_000;
    const cab = buildSignatureHeader(corpo, 'whsec_x', t0);
    const J = TOLERANCIA_DA_ASSINATURA_SEGUNDOS;
    for (const d of [-J - 1, -J, -1, 0, 1, J, J + 1]) {
      const agora = t0 + d;
      expect(filtroAceita(t0, agora), `agora = t + ${d}`).toBe(
        verifySignatureHeader(cab, corpo, 'whsec_x', agora)
      );
    }
    // E a borda de verdade está lá: um segundo além da janela é recusado.
    expect(filtroAceita(t0, t0 + J + 1)).toBe(false);
    expect(filtroAceita(t0, t0 + J)).toBe(true);
  });
});

describe('credenciais e filtros', () => {
  it('n8n: Bearer Token SEM a palavra Bearer; Make: Key COM ela', () => {
    expect(credencialDoN8n(M)).toContain('Bearer Token: SUA_CHAVE');
    expect(credencialDoN8n(M)).not.toContain('Bearer SUA_CHAVE');
    expect(chaveNoMake(M)).toContain('Key: Bearer SUA_CHAVE');
  });

  it('o filtro da receita corta o laço (source system) e o envio de teste', () => {
    const texto = filtroDeEtapaNoN8n(M);
    expect(texto).toContain('deal.stage_changed');
    expect(texto).toContain('ID_DA_ETAPA');
    expect(texto).toContain('is not equal to  system');
    expect(texto).toContain('$json.body.test');
  });
});
