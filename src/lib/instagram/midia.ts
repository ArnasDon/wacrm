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
 */
export async function baixarUrlPublica(
  url: string,
  fetchFn: typeof fetch
): Promise<Response> {
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
    const r = await fetchFn(alvo, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });
    if (r.status < 300 || r.status >= 400) return r;
    const destino = r.headers.get('location');
    if (!destino || salto >= MAX_SALTOS) {
      throw new Error(`Media download failed: redirect ${r.status}`);
    }
    alvo = new URL(destino, alvo).toString();
  }
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
        buffer: Buffer.from(await r.arrayBuffer()),
        contentType:
          r.headers.get('content-type') || 'application/octet-stream',
      };
    },
  });
  if (!url) return null;
  return { url, mime: m.mime, classe: m.classe, filename };
}
