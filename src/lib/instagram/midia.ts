// ============================================================
// A mídia da DM: baixar a URL ASSINADA do CDN da Meta na hora e guardar no
// Storage. Só de servidor.
//
// Medido na Fase 0: a URL (`lookaside.fbsbx.com/ig_messaging_cdn/…&signature=`)
// vem com `cache-control: no-store` e EXPIRA — gravá-la em `media_url`
// deixaria a bolha "indisponível" horas depois. E o CDN entrega a nota de
// voz como `content-type: video/mp4` (`audioclip-<epoch>.mp4`): quem decide
// classe e mime é o `type` do webhook (`midiaDoAnexo`), nunca o cabeçalho.
//
// Reusa o espelhamento da Meta Cloud API (`mirrorInboundMedia`: teto de
// entrada, nome do objeto, upload, URL pública) com um download próprio —
// a URL assinada NÃO leva `Authorization`, e mandar um Bearer para o CDN
// seria entregar o token a um host que não o pediu.
//
// ⚠️ A URL vem do CORPO do webhook, e quem assina o corpo é o app da Meta
// DAQUELA conexão (`quaisAssinam`, na rota): a conta que cadastra uma conexão
// Instagram com o próprio segredo forja a entrega. Baixada sem guarda, a URL
// era SSRF com LEITURA — `http://127.0.0.1:3000/…`, o metadado da nuvem ou
// um nome interno do Swarm, e a resposta ia parar no bucket público. Por isso
// `baixarUrlPublica`: só `https`, cada salto conferido por `isDeliverableUrl`
// e o redirecionamento seguido À MÃO (não se desliga — não foi medido se o CDN
// da Meta redireciona, e desligar sumiria com a mídia legítima). Nenhuma
// lista de hosts da Meta: adivinhar o domínio do CDN quebraria a mídia no dia
// em que ele mudar; o que se barra é o endereço NÃO público.
// ============================================================

import { createHash } from 'node:crypto';

import { MEDIA_MAX_BYTES_ENTRADA } from '@/lib/storage/upload-media';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import {
  mirrorInboundMedia,
  type MirrorStorage,
} from '@/lib/whatsapp/mirror-inbound-media';

import type { MidiaSalva } from './persistir';
import { midiaDoAnexo, type AnexoDoInstagram } from './webhook';

const TIMEOUT_MS = 20_000;

/** Saltos de redirecionamento aceitos até o arquivo. */
export const MAX_SALTOS = 3;

/**
 * GET de uma URL que veio de fora, sem alcançar a rede interna: só `https`,
 * cada salto (o primeiro e cada `Location`) conferido por `isDeliverableUrl`,
 * e no máximo `MAX_SALTOS` redirecionamentos. Lança em qualquer recusa — o
 * chamador (`mirrorInboundMedia`) transforma o erro em "anexo indisponível".
 *
 * O prazo é UM para a cadeia inteira, corpo incluído (o sinal segue valendo
 * na leitura): por salto, três redirecionamentos lentos seguravam o `after()`
 * do webhook por 80 s. O corpo de cada 3xx é descartado antes do próximo
 * pedido — sem isso o undici segura a conexão até o coletor de lixo.
 */
export async function baixarUrlPublica(
  url: string,
  fetchFn: typeof fetch
): Promise<Response> {
  const sinal = AbortSignal.timeout(TIMEOUT_MS);
  let alvo = url;
  for (let salto = 0; ; salto++) {
    let protocolo: string;
    try {
      protocolo = new URL(alvo).protocol;
    } catch {
      throw new Error('Media download refused: malformed URL');
    }
    if (protocolo !== 'https:') {
      throw new Error(`Media download refused: ${protocolo} is not https`);
    }
    if (!(await isDeliverableUrl(alvo))) {
      throw new Error('Media download refused: host is not public');
    }
    const r = await fetchFn(alvo, { signal: sinal, redirect: 'manual' });
    if (r.status < 300 || r.status >= 400) return r;
    await r.body?.cancel().catch(() => {});
    const destino = r.headers.get('location');
    if (!destino || salto >= MAX_SALTOS) {
      throw new Error(`Media download failed: redirect ${r.status}`);
    }
    alvo = new URL(destino, alvo).toString();
  }
}

/**
 * O corpo inteiro, recusando o que passa de `teto` DURANTE a leitura.
 *
 * O anexo do Instagram não traz tamanho no webhook, então o teto de entrada
 * (`MEDIA_MAX_BYTES_ENTRADA`) só era conferido pelo `mirrorInboundMedia`
 * DEPOIS de o arquivo inteiro estar na memória — e a URL vem de fora: um
 * corpo de gigabytes derrubava o processo Node, que é de todas as contas.
 * `content-length` acima do teto recusa sem ler; sem ele (ou mentindo), a
 * contagem para a leitura no primeiro byte a mais.
 */
export async function lerComTeto(r: Response, teto: number): Promise<Buffer> {
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > teto) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`Media download refused: ${declarado} bytes over the ${teto}-byte limit`);
  }
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => {});
      throw new Error(`Media download refused: over the ${teto}-byte limit`);
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos);
}

/** `filename=audioclip-1757460907-0.mp4` do content-disposition, se vier. */
export function nomeDoContentDisposition(
  header: string | null | undefined
): string | null {
  if (!header) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1].trim()) : null;
}

/** Curto e estável: o `mid` tem ~120 caracteres e entra no nome do objeto. */
export function chaveCurta(mid: string): string {
  return createHash('sha1').update(mid).digest('hex').slice(0, 12);
}

export async function salvarMidiaDoInstagram(args: {
  storage: MirrorStorage;
  accountId: string;
  anexo: AnexoDoInstagram;
  mid: string;
  timestampMs: number | null;
  fetchFn?: typeof fetch;
}): Promise<MidiaSalva | null> {
  const m = midiaDoAnexo(args.anexo);
  if (!m || !args.anexo.url) return null;
  const fetchFn = args.fetchFn ?? fetch;
  let filename: string | null = null;

  const url = await mirrorInboundMedia({
    storage: args.storage,
    accountId: args.accountId,
    mediaId: `ig-${chaveCurta(args.mid)}`,
    downloadUrl: args.anexo.url,
    accessToken: '', // a URL é assinada; ver o cabeçalho
    mimeType: m.mime,
    messageTimestamp: args.timestampMs,
    download: async ({ downloadUrl }) => {
      const r = await baixarUrlPublica(downloadUrl, fetchFn);
      if (!r.ok) throw new Error(`Media download failed: ${r.status}`);
      filename = nomeDoContentDisposition(r.headers.get('content-disposition'));
      return {
        buffer: await lerComTeto(r, MEDIA_MAX_BYTES_ENTRADA),
        contentType:
          r.headers.get('content-type') || 'application/octet-stream',
      };
    },
  });
  if (!url) return null;
  return { url, mime: m.mime, classe: m.classe, filename };
}
