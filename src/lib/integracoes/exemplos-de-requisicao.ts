// ============================================================
// Os trechos de código da aba "Documentação" (Configurações → API) — puro.
//
// A aba ensina a ligar o CRM ao n8n e ao Make, e cada trecho aqui é o que o
// operador COLA do outro lado: um curl, um JSON de exemplo, o nó Code que
// confere a assinatura. Por isso eles saem de código, e não do dicionário:
//   - o curl leva a URL base REAL desta instalação (quem copia o exemplo
//     da documentação genérica esquece de trocar o domínio);
//   - o JSON do aviso sai de `exemploDeEnvelope`, o mesmo tipo que o
//     disparo exige — o exemplo não mente sobre o que chega;
//   - o dicionário vai INTEIRO para o navegador em toda página, e trechos
//     de código lá dentro pesariam em todas as rotas, não só nesta.
//
// ⚠️ IMPORTÁVEL NO NAVEGADOR. Os números e nomes que a tela AFIRMA (prefixo
// da chave, limite por minuto, prazo da entrega, falhas que desligam,
// cabeçalhos) moram em módulos de servidor que arrastam `node:crypto` ou
// `next/server` (`api-keys/keys.ts`, `rate-limit.ts`, `webhooks/deliver.ts`,
// `webhooks/sign.ts`). Importá-los aqui quebraria o bundle da tela. Então
// eles são ESPELHADOS como constantes, e `exemplos-de-requisicao.test.ts`
// (que roda em Node) amarra cada uma à fonte de verdade: mudou o limite no
// servidor e não aqui, o CI reprova — em vez de a tela afirmar "120 por
// minuto" sobre um limite que já é outro. Foi exatamente o que aconteceu
// com o texto "5 segundos" e "Quinze" digitados à mão no dicionário.
//
// Os MARCADORES (`SUA_CHAVE`, `ID_DO_CONTATO`…) vêm do dicionário, por
// parâmetro: o trecho é o mesmo nos dois idiomas, mas o que o leitor tem de
// trocar precisa estar na língua dele.
//
// Dados de exemplo FICTÍCIOS (telefone +55 11 90000-0000 não é de ninguém).
// ============================================================

import type { WebhookEvent } from '@/lib/webhooks/events';
import { exemploDeEnvelope } from '@/lib/webhooks/exemplos';

// ------------------------------------------------------------
// Constantes espelhadas (amarradas à fonte pelo teste)
// ------------------------------------------------------------

/** Espelho de `API_KEY_PREFIX` (`src/lib/api-keys/keys.ts`). */
export const PREFIXO_DA_CHAVE = 'wacrm_live_';

/** Espelho de `WEBHOOK_SECRET_PREFIX` (`src/lib/webhooks/endpoints.ts`). */
export const PREFIXO_DO_SEGREDO = 'whsec_';

/** Espelho de `RATE_LIMITS.publicApi.limit` (janela de um minuto). */
export const LIMITE_POR_MINUTO = 120;

/** Espelho de `MAX_LIMIT` (`src/lib/api/v1/pagination.ts`). */
export const TAMANHO_MAXIMO_DA_PAGINA = 100;

/** Espelho de `DELIVERY_TIMEOUT_MS / 1000` (`src/lib/webhooks/deliver.ts`). */
export const PRAZO_DA_ENTREGA_SEGUNDOS = 5;

/** Espelho de `MAX_CONSECUTIVE_FAILURES` (`src/lib/webhooks/deliver.ts`). */
export const FALHAS_QUE_DESLIGAM = 15;

/**
 * A janela contra replay que a própria verificação do CRM usa
 * (`verifySignatureHeader`, padrão de `toleranceSeconds`). O teste a MEDE
 * chamando a função — não lê o número do fonte.
 */
export const TOLERANCIA_DA_ASSINATURA_SEGUNDOS = 300;

/** Os três cabeçalhos de toda entrega (`deliver.ts`, conferidos no fonte). */
export const CABECALHO_DO_EVENTO = 'X-Wacrm-Event';
export const CABECALHO_DO_ENDERECO = 'X-Wacrm-Webhook-Id';
export const CABECALHO_DA_ASSINATURA = 'X-Wacrm-Signature';

/**
 * Intervalo entre páginas no n8n: o que cabe no limite por minuto, com 20%
 * de folga (o relógio do n8n e o do CRM não andam juntos). Derivado, nunca
 * digitado: com o limite em 120/min dá 600 ms.
 */
export const INTERVALO_ENTRE_PAGINAS_MS = Math.ceil(
  (60_000 / LIMITE_POR_MINUTO) * 1.2
);

// ------------------------------------------------------------
// Entradas
// ------------------------------------------------------------

/** O que o leitor tem de trocar em cada trecho, na língua dele. */
export interface Marcadores {
  /** A chave de API inteira (`wacrm_live_…`). */
  chave: string;
  idDoContato: string;
  idDoFunil: string;
  idDaEtapa: string;
  idDaConexao: string;
  /** O segredo do endereço de webhook enviado (`whsec_…`). */
  segredo: string;
  tituloDoNegocio: string;
  textoDaMensagem: string;
}

/**
 * A URL base da API nesta instalação: `NEXT_PUBLIC_SITE_URL` (inlinado no
 * build) e, sem ela, a origem de onde a tela foi aberta. `null` só enquanto
 * nenhuma das duas existe (a renderização no servidor, antes da hidratação).
 *
 * ⚠️ Nunca `request.url` do lado do servidor: o `standalone` sobe com
 * `HOSTNAME=0.0.0.0` e a URL sairia `http://0.0.0.0:3000`
 * (`src/lib/auth/origem-publica.ts`).
 */
export function urlBaseDoCrm(
  siteUrl: string | null | undefined,
  origem: string | null | undefined
): string | null {
  const base = siteUrl?.trim() || origem?.trim() || '';
  return base ? base.replace(/\/+$/, '') : null;
}

// ------------------------------------------------------------
// curl
// ------------------------------------------------------------

/**
 * Aspas simples de shell em volta de `texto`. Um apóstrofo no marcador
 * ("We've got…") fecharia a aspa do `-d '…'` no meio do JSON e o curl
 * colado quebraria sem dizer por quê — daí o `'\''` de sempre.
 */
function emAspasDoShell(texto: string): string {
  return `'${texto.replace(/'/g, `'\\''`)}'`;
}

function curl(
  metodo: 'GET' | 'POST' | 'PATCH',
  url: string,
  chave: string,
  corpo?: unknown
): string {
  const linhas = [
    metodo === 'GET' ? `curl ${url}` : `curl -X ${metodo} ${url}`,
    `  -H "Authorization: Bearer ${chave}"`,
  ];
  if (corpo !== undefined) {
    linhas.push(`  -H "Content-Type: application/json"`);
    linhas.push(`  -d ${emAspasDoShell(JSON.stringify(corpo, null, 2))}`);
  }
  return linhas.join(' \\\n');
}

/** `GET /api/v1/me`: confere a chave. Não pede escopo nenhum. */
export function curlDoMe(base: string, m: Marcadores): string {
  return curl('GET', `${base}/api/v1/me`, m.chave);
}

/** `GET /api/v1/pipelines`: funis com as etapas. Escopo `deals:read`. */
export function curlDosFunis(base: string, m: Marcadores): string {
  return curl('GET', `${base}/api/v1/pipelines`, m.chave);
}

/**
 * `POST /api/v1/deals`. `stage_id` é OBRIGATÓRIO de propósito: a etapa de
 * entrada é decisão de produto, não "a primeira coluna".
 */
export function curlCriarNegocio(base: string, m: Marcadores): string {
  return curl('POST', `${base}/api/v1/deals`, m.chave, {
    contact_id: m.idDoContato,
    pipeline_id: m.idDoFunil,
    stage_id: m.idDaEtapa,
    title: m.tituloDoNegocio,
  });
}

/**
 * `POST /api/v1/contacts/{id}/tags`: ACRESCENTA sem tirar as outras (o
 * `tags` do PATCH do contato substitui o conjunto inteiro).
 */
export function curlAplicarEtiqueta(base: string, m: Marcadores): string {
  return curl(
    'POST',
    `${base}/api/v1/contacts/${m.idDoContato}/tags`,
    m.chave,
    { add: ['Typebot'] }
  );
}

/** `PATCH /api/v1/contacts/{id}/custom-fields`: pela CHAVE do campo. */
export function curlPreencherCampo(base: string, m: Marcadores): string {
  return curl(
    'PATCH',
    `${base}/api/v1/contacts/${m.idDoContato}/custom-fields`,
    m.chave,
    { values: { utm_source: 'instagram' } }
  );
}

/**
 * `POST /api/v1/messages`: pelo telefone, com DDI; `channel_id` opcional.
 *
 * ⚠️ O exemplo LEVA o `channel_id`, de propósito, e a receita diz o preço:
 * com ele a conversa fica FIXADA naquele número (`pinConversationChannel`
 * na rota) e deixa de seguir o cliente. Sem ele, a mensagem sai pelo número
 * em que a conversa já está — que "segue o cliente" —, e numa conta com
 * vários números o remetente de um lembrete disparado pelo n8n ficaria
 * imprevisível: sairia pelo número por onde o cliente escreveu da última
 * vez, fosse qual fosse. Para integração, escolher o número é o caso comum;
 * numa conta de um número só, fixar nele não muda nada.
 *
 * E o marcador serve de trava: colado sem trocar `ID_DA_CONEXAO`, o pedido
 * volta `400` ("not a channel of this account") em vez de mandar a mensagem
 * pelo número que o CRM escolhesse. O telefone do exemplo é fictício, mas
 * quem cola o curl troca o telefone e esquece o resto. (A trava não é
 * perfeita: a rota acha-ou-cria a ficha e a conversa ANTES de conferir o
 * canal, então esse 400 deixa a ficha do telefone criada — nada é enviado.)
 */
export function curlMandarMensagem(base: string, m: Marcadores): string {
  return curl('POST', `${base}/api/v1/messages`, m.chave, {
    to: '+5511900000000',
    type: 'text',
    text: m.textoDaMensagem,
    channel_id: m.idDaConexao,
  });
}

// ------------------------------------------------------------
// Avisos (webhooks enviados)
// ------------------------------------------------------------

/**
 * O corpo de exemplo de um aviso, como ele chega — o envelope inteiro, com
 * dados fictícios. É o MESMO objeto que o botão "Enviar teste" manda (lá
 * com `"test": true`).
 */
export function jsonDoEvento(evento: WebhookEvent): string {
  return JSON.stringify(exemploDeEnvelope(evento), null, 2);
}

// ------------------------------------------------------------
// n8n
// ------------------------------------------------------------
// Os nomes de campo abaixo são os da interface do n8n e do Make, que é em
// inglês — traduzi-los tornaria o passo a passo inútil (a mesma regra dos
// rótulos do painel da Meta). Os identificadores do código são em inglês
// pelo mesmo motivo: é o que o leitor cola num editor que fala inglês.

/** A credencial do nó HTTP Request. O n8n acrescenta o "Bearer " sozinho. */
export function credencialDoN8n(m: Marcadores): string {
  return [
    'Authentication: Generic Credential Type',
    'Generic Auth Type: Bearer Auth',
    `Bearer Token: ${m.chave}`,
  ].join('\n');
}

/**
 * A paginação do nó HTTP Request. O cursor opaco vem em `meta.next_cursor`
 * e é `null` na última página — é isso que encerra o laço.
 */
export function paginacaoDoN8n(): string {
  return [
    `Send Query Parameters → limit = ${TAMANHO_MAXIMO_DA_PAGINA}`,
    'Options → Pagination',
    '  Pagination Mode: Update a Parameter in Each Request',
    '  Type: Query · Name: cursor',
    '  Value: {{ $response.body.meta.next_cursor }}',
    '  Pagination Complete When: Other',
    '  Complete Expression: {{ !$response.body.meta.next_cursor }}',
    `  Interval Between Requests (ms): ${INTERVALO_ENTRE_PAGINAS_MS}`,
  ].join('\n');
}

/**
 * O nó Code que prepara a conferência da assinatura. Roda no modo
 * "Run Once for All Items", depois de um nó Webhook com Raw Body ligado.
 *
 * ⚠️ O corpo é lido pelo helper `getBinaryDataBuffer`, nunca por
 * `binary.data.data`: com os binários guardados em disco, aquele campo traz
 * uma referência no lugar do conteúdo. E o HMAC é sobre os BYTES CRUS —
 * reserializar `$json.body` só coincide por sorte.
 *
 * O HMAC em si fica para o nó Crypto (`assinaturaNoN8n`), com o segredo na
 * credencial: assim ele não aparece no código do fluxo, e o Code não
 * precisa de `require('crypto')` (que o n8n instalado no servidor só libera
 * com `NODE_FUNCTION_ALLOW_BUILTIN`).
 *
 * O teste EXECUTA este texto contra uma assinatura gerada por
 * `buildSignatureHeader`: se ele deixar de reproduzir o `v1`, o CI reprova.
 */
export function codigoDoN8n(): string {
  const cabecalho = CABECALHO_DA_ASSINATURA.toLowerCase();
  return [
    'const item = $input.first();',
    `const header = String(item.json.headers['${cabecalho}'] ?? '');`,
    'const parts = Object.fromEntries(',
    "  header.split(',').map((p) => {",
    "    const i = p.indexOf('=');",
    '    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];',
    '  })',
    ');',
    "const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');",
    'return [{',
    '  json: {',
    '    message: `${parts.t}.${raw}`,',
    "    v1: String(parts.v1 ?? '').toLowerCase(),",
    '    t: Number(parts.t),',
    '    body: JSON.parse(raw),',
    '  },',
    '}];',
  ].join('\n');
}

/** Os dois nós depois do Code: o HMAC e a comparação (com a janela). */
export function assinaturaNoN8n(m: Marcadores): string {
  return [
    'Crypto → Action: Hmac · Type: SHA256',
    '         Value: {{ $json.message }}',
    '         Property Name: computed · Encoding: HEX',
    `         Hmac Secret (credential): ${m.segredo}`,
    'IF     → {{ $json.computed }}  is equal to  {{ $json.v1 }}',
    `         AND {{ Math.abs($now.toSeconds() - $json.t) }}  is less than  ${TOLERANCIA_DA_ASSINATURA_SEGUNDOS}`,
  ].join('\n');
}

/**
 * O filtro da receita "quando o lead mudar de etapa". O `source` diferente
 * de `system` é o que corta o laço: mover o card pela API gera outro aviso,
 * com `source: "system"`.
 */
export function filtroDeEtapaNoN8n(m: Marcadores): string {
  return [
    'IF → {{ $json.body.event }}  is equal to  deal.stage_changed',
    `     AND {{ $json.body.data.stage.id }}  is equal to  ${m.idDaEtapa}`,
    '     AND {{ $json.body.data.source }}  is not equal to  system',
    '     AND {{ $json.body.test }}  is not equal to  true',
  ].join('\n');
}

// ------------------------------------------------------------
// Make
// ------------------------------------------------------------

/** O keychain do HTTP → Make a request. Ao contrário do n8n, COM "Bearer ". */
export function chaveNoMake(m: Marcadores): string {
  return [
    'Authentication type: API key',
    `Key: Bearer ${m.chave}`,
    'API key placement: In the header',
    'API key parameter name: Authorization',
  ].join('\n');
}

/** A paginação do HTTP → Make a request. */
export function paginacaoDoMake(): string {
  return [
    'Pagination type: Token or cursor-based',
    'Items path: data',
    'Next page token/cursor path: meta.next_cursor',
    'Page token/cursor parameter name: cursor',
    `Page size parameter name / value: limit / ${TAMANHO_MAXIMO_DA_PAGINA}`,
  ].join('\n');
}

/**
 * A conferência da assinatura no Make: com JSON pass-through o corpo cru
 * chega em `1.value`, e `sha256` COM chave devolve o HMAC. Os arrays do
 * Make começam em 1.
 *
 * ⚠️ O Filter confere TAMBÉM a idade de `t`, não só o HMAC. A tela manda
 * recusar `t` com mais de `TOLERANCIA_DA_ASSINATURA_SEGUNDOS`, e até
 * 23/09/2026 este trecho só comparava a assinatura: uma entrega capturada
 * (log de proxy, histórico do próprio Make) podia ser reenviada a qualquer
 * hora e passaria — a janela é a proteção contra replay, e o HMAC sozinho
 * não a dá (o corpo reenviado é o mesmo, a assinatura também).
 *
 * São DUAS comparações numéricas contra `timestamp` (a variável do Make com
 * o agora em segundos Unix), e não uma sobre a diferença absoluta: o Make
 * não tem `abs`, e `t` chega como TEXTO — por isso a conta fica do lado do
 * `timestamp` (número) e `t` é só o operando que o operador numérico do
 * Filter converte. As duas juntas são `|agora − t| ≤ janela`, inclusive nas
 * bordas, que é exatamente a régua de `verifySignatureHeader` (o teste
 * compara as duas nas bordas).
 */
export function assinaturaNoMake(m: Marcadores): string {
  const cabecalho = CABECALHO_DA_ASSINATURA.toLowerCase();
  const janela = TOLERANCIA_DA_ASSINATURA_SEGUNDOS;
  return [
    `sig = {{get(map(1.__IMTHEADERS__; "value"; "name"; "${cabecalho}"); 1)}}`,
    't   = {{replace(get(split(sig; ","); 1); "t="; "")}}',
    'v1  = {{replace(get(split(sig; ","); 2); "v1="; "")}}',
    '',
    `Filter: v1  Equal to  {{sha256(t + "." + 1.value; "hex"; "${m.segredo}")}}`,
    `    AND t   Numeric: Greater than or equal to  {{timestamp - ${janela}}}`,
    `    AND t   Numeric: Less than or equal to  {{timestamp + ${janela}}}`,
  ].join('\n');
}
