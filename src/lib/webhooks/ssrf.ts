// ============================================================
// SSRF guard for outbound webhook delivery.
//
// A webhook URL is attacker-influenced (any account admin with
// `webhooks:manage` can register one) and our server makes the request,
// so an unguarded fetch is a Server-Side Request Forgery primitive: a
// URL pointing at `127.0.0.1`, a cloud metadata IP (`169.254.169.254`),
// or an RFC1918 host would let a caller probe / POST to internal
// services from the app's network.
//
// `isDeliverableUrl` resolves the host and rejects any address that is
// loopback, private, link-local, ULA, or otherwise non-publicly-
// routable. Combined with `redirect: 'manual'` at the call site (so a
// public URL can't 3xx-bounce to an internal one), this blocks the
// common SSRF vectors. It is NOT a defense against DNS rebinding (a
// host that resolves public here but flips to private before connect) —
// that needs pinning the resolved IP into the socket, which fetch
// doesn't expose; documented as a residual risk.
// ============================================================

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for loopback / private / link-local / reserved IPv4 or IPv6. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (!ip.includes(':')) return false; // not an IP literal at all

  // ⚠️⚠️ IPv6 é julgado pelos BITS, nunca pelo TEXTO. A versão anterior
  // comparava prefixos de string e só reconhecia o IPv4 mapeado na forma com
  // pontos (`::ffff:127.0.0.1`). Mas o parser de URL NORMALIZA o endereço:
  // `new URL('https://[::ffff:127.0.0.1]/').hostname` é `[::ffff:7f00:1]`, e
  // é essa forma hexadecimal que chega aqui vinda de `isDeliverableUrl`. O
  // guarda deixava passar `https://[::ffff:127.0.0.1]/`,
  // `[::ffff:169.254.169.254]` (o metadado da nuvem) e toda a rede privada —
  // e o Node conecta de verdade: socket IPv6 com endereço mapeado vira uma
  // conexão IPv4 com o endereço embutido (medido em 23/09/2026:
  // `net.connect` a `::ffff:7f00:1` abre conexão num servidor que só ouve em
  // 127.0.0.1). Pelo mesmo motivo,
  // `0:0:0:0:0:ffff:7f00:1` e `::FFFF:7F00:1` são o mesmo endereço, e só a
  // leitura por hextetos vê isso.
  const h = hextetos(ip);
  // Tem `:` e não é IPv6 válido: não sei o que é, então não entrego. Os
  // chamadores só mandam o que `isIP` aceitou, mas a função é exportada.
  if (!h) return true;

  // ::/64 — o não especificado (`::`), o loopback (`::1`), o IPv4-compatível
  // (`::a.b.c.d`, obsoleto) e o IPv4-mapeado (`::ffff:a.b.c.d`) moram aqui, e
  // nenhum endereço público. Só o MAPEADO chega a um host (o kernel o troca
  // pela conexão IPv4), então ele é julgado pelo IPv4 embutido —
  // `::ffff:8.8.8.8` continua entregável; o resto do bloco é recusado.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
    if (h[4] === 0 && h[5] === 0xffff) return isPrivateOrReservedIp(ipv4DosHextetos(h[6], h[7]));
    return true;
  }

  // NAT64 (64:ff9b::/96, RFC 6052) e 6to4 (2002::/16, RFC 3056) também
  // EMBUTEM um IPv4, e o tradutor/relay entrega a ele. Decisão: julgar o IPv4
  // embutido, e NÃO recusar o prefixo inteiro. Motivo: numa rede só-IPv6 com
  // DNS64 (há nuvens que entregam assim) o `lookup` de QUALQUER site só-IPv4
  // devolve `64:ff9b::<ipv4 público>` — recusar o prefixo desligaria todo
  // webhook daquela instalação, em silêncio, e o produto é instalado por
  // terceiros. Com o IPv4 embutido público, entregar pelo tradutor é
  // entregar ao mesmo host que o guarda já aceitaria direto; com ele
  // privado, é o SSRF que este arquivo existe para barrar.
  if (h[0] === 0x64 && h[1] === 0xff9b) {
    if (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
      return isPrivateOrReservedIp(ipv4DosHextetos(h[6], h[7]));
    }
    // 64:ff9b:1::/48 é o prefixo NAT64 de USO LOCAL (RFC 8215) — rede
    // interna por definição, e o IPv4 embutido nem fica numa posição fixa. O
    // resto de 64:ff9b::/32 não é atribuído. Recusado inteiro.
    return true;
  }
  if (h[0] === 0x2002) return isPrivateOrReservedIp(ipv4DosHextetos(h[1], h[2])); // 6to4

  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (obsoleto, mas ainda "interno")
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  return false;
}

/** Os dois últimos hextetos (32 bits) de um IPv6, como IPv4 com pontos. */
function ipv4DosHextetos(alto: number, baixo: number): string {
  return `${alto >> 8}.${alto & 0xff}.${baixo >> 8}.${baixo & 0xff}`;
}

/**
 * Os oito hextetos (16 bits cada) de um IPv6, ou `null` se não for um.
 * Aceita colchetes, zona (`%eth0`, descartada) e a cauda IPv4 com pontos
 * (`::ffff:127.0.0.1`, a forma que o `lookup` do Node devolve).
 */
function hextetos(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');

  const cauda = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (cauda) {
    const o = cauda.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${cauda[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }

  const lados = s.split('::');
  if (lados.length > 2) return null;
  const esquerda = lados[0] ? lados[0].split(':') : [];
  const direita = lados.length === 2 && lados[1] ? lados[1].split(':') : [];
  const faltam = 8 - esquerda.length - direita.length;
  // Sem `::`, tem de haver exatamente 8; com `::`, ele vale pelo menos um.
  if (lados.length === 1 ? faltam !== 0 : faltam < 1) return null;

  const todos = [...esquerda, ...new Array<string>(lados.length === 2 ? faltam : 0).fill('0'), ...direita];
  if (!todos.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return todos.map((g) => parseInt(g, 16));
}

/**
 * True if `rawUrl`'s host resolves only to publicly-routable
 * address(es). Returns false for a malformed URL, an obvious internal
 * name (`localhost`, `*.local`, `*.internal`), a literal private IP, or
 * a hostname that resolves to any private/reserved address.
 */
export async function isDeliverableUrl(rawUrl: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }

  if (isIP(host)) return !isPrivateOrReservedIp(host);

  const lower = host.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return false;
  }

  try {
    const results = await lookup(host, { all: true });
    if (results.length === 0) return false;
    return results.every((r) => !isPrivateOrReservedIp(r.address));
  } catch {
    return false; // unresolvable → not deliverable
  }
}
