import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export const MAX_HTTP_REDIRECTS = 3;
export const MAX_HTTP_RESPONSE_BYTES = 512 * 1024;

export interface HttpRequestConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  response_var: string;
}

export interface HttpRequestOutput {
  status: number;
  body: unknown;
  content_type: string;
}

type PinnedTransport = (
  input: string,
  address: string,
  init: RequestInit,
) => Promise<Response>;

export interface HttpRequestDependencies {
  transport?: PinnedTransport;
  lookup?: (host: string) => Promise<readonly string[]>;
  signal?: AbortSignal;
}

const SECRET_HEADER =
  /(?:^|[-_])(authorization|cookie|api[-_]?key|auth[-_]?token|access[-_]?token)(?:$|[-_])/i;
const CROSS_ORIGIN_SECRET_HEADER = SECRET_HEADER;

export function sanitizeHttpHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SECRET_HEADER.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const raw = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const parts = raw.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const octets = parts.map(Number);
    if (octets.some((part) => part < 0 || part > 255)) return true;
    const [a, b, c] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  const bytes = parseIpv6Bytes(raw);
  if (!bytes) return true;
  if (
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return isPrivateOrReservedIp(
      `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`,
    );
  }
  // Only globally routable unicast is accepted. This excludes unspecified,
  // loopback, ULA/link-local, multicast, NAT64 and other special-use space.
  if ((bytes[0] & 0xe0) !== 0x20) return true; // 2000::/3
  if (matchesIpv6Prefix(bytes, [0x20, 0x01], 23)) return true;
  if (matchesIpv6Prefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return true;
  if (matchesIpv6Prefix(bytes, [0x20, 0x02], 16)) return true; // 6to4
  if (matchesIpv6Prefix(bytes, [0x3f, 0xff], 20)) return true;
  return false;
}

function parseIpv6Bytes(input: string): Uint8Array | null {
  if (isIP(input) !== 6) return null;
  let value = input;
  const ipv4Match = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const octets = ipv4Match[1].split(".").map(Number);
    value = `${value.slice(0, -ipv4Match[1].length)}${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some((word) => !Number.isFinite(word))) {
    return null;
  }
  return Uint8Array.from(words.flatMap((word) => [word >> 8, word & 0xff]));
}

function matchesIpv6Prefix(
  address: Uint8Array,
  prefix: number[],
  bits: number,
): boolean {
  const whole = Math.floor(bits / 8);
  for (let index = 0; index < whole; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (address[whole] & mask) === ((prefix[whole] ?? 0) & mask);
}

function parseAndAssertHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("HTTP request URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HTTP request URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("HTTP request URL cannot contain credentials");
  }
  if (url.hash) throw new Error("HTTP request URL cannot contain a fragment");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("HTTP request host is not publicly routable");
  }
  if (isIP(host) && isPrivateOrReservedIp(host)) {
    throw new Error("HTTP request host is not publicly routable");
  }
  return url;
}

export function assertAuthorableHttpUrl(rawUrl: string): string {
  return parseAndAssertHttpUrl(rawUrl).toString();
}

async function assertPublicRuntimeTarget(
  url: URL,
  lookup: NonNullable<HttpRequestDependencies["lookup"]>,
): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await lookup(host);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateOrReservedIp(address))
  ) {
    throw new Error("HTTP request target is not publicly routable");
  }
  return addresses[0];
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function stripCrossOriginCredentials(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => !CROSS_ORIGIN_SECRET_HEADER.test(key),
    ),
  );
}

async function pinnedNodeTransport(
  input: string,
  address: string,
  init: RequestInit,
): Promise<Response> {
  const url = new URL(input);
  const headers = headersToRecord(init.headers);
  headers.Host = url.host;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise<Response>((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers,
        signal: init.signal ?? undefined,
        ...(url.protocol === "https:" && !isIP(url.hostname)
          ? { servername: url.hostname }
          : {}),
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) responseHeaders.append(key, entry);
          } else if (value !== undefined) {
            responseHeaders.set(key, value);
          }
        }
        const status = incoming.statusCode ?? 500;
        const responseBody = [204, 205, 304].includes(status)
          ? null
          : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
        resolve(
          new Response(responseBody, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    req.on("error", reject);
    if (typeof init.body === "string" || init.body instanceof Uint8Array) {
      req.write(init.body);
    } else if (init.body !== null && init.body !== undefined) {
      req.destroy(new Error("HTTP request body type is unsupported"));
      return;
    }
    req.end();
  });
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTTP_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("HTTP response is too large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTTP_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("HTTP response is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The next hop/error must not keep a response socket alive.
  }
}

function removeEntityHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) =>
        !["content-length", "content-type"].includes(key.toLowerCase()),
    ),
  );
}

export async function executeHttpRequest(
  config: HttpRequestConfig,
  dependencies: HttpRequestDependencies = {},
): Promise<HttpRequestOutput> {
  const transport: PinnedTransport =
    dependencies.transport ?? pinnedNodeTransport;
  const lookup =
    dependencies.lookup ??
    (async (host: string) =>
      (await dnsLookup(host, { all: true })).map((result) => result.address));
  let url = parseAndAssertHttpUrl(config.url);
  let headers = { ...(config.headers ?? {}) };
  let method: string = config.method;
  let requestBody: string | undefined =
    config.method === "GET" || config.method === "DELETE"
      ? undefined
      : config.body;

  for (let redirect = 0; redirect <= MAX_HTTP_REDIRECTS; redirect += 1) {
    const pinnedAddress = await assertPublicRuntimeTarget(url, lookup);
    const requestHeaders = { ...headers, Host: url.host };
    const response = await transport(url.toString(), pinnedAddress, {
      method,
      headers: requestHeaders,
      body: requestBody,
      redirect: "manual",
      signal: dependencies.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await discardResponseBody(response);
      if (!location) throw new Error("HTTP redirect is missing location");
      if (redirect === MAX_HTTP_REDIRECTS) {
        throw new Error("HTTP redirect limit exceeded");
      }
      const nextUrl = parseAndAssertHttpUrl(new URL(location, url).toString());
      if (nextUrl.origin !== url.origin) {
        headers = stripCrossOriginCredentials(headers);
      }
      const becomesGet =
        response.status === 303
          ? method !== "HEAD"
          : (response.status === 301 || response.status === 302) &&
            method === "POST";
      if (becomesGet) {
        method = "GET";
        requestBody = undefined;
        headers = removeEntityHeaders(headers);
      }
      url = nextUrl;
      continue;
    }
    if (!response.ok) {
      await discardResponseBody(response);
      throw new Error(`HTTP request failed with status ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") ?? "text/plain")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      contentType !== "application/json" &&
      contentType !== "text/plain" &&
      !contentType.endsWith("+json")
    ) {
      await discardResponseBody(response);
      throw new Error("HTTP response has unsupported content type");
    }
    const bytes = await readBoundedBody(response);
    const text = new TextDecoder().decode(bytes);
    let body: unknown = text;
    if (contentType === "application/json" || contentType.endsWith("+json")) {
      body = text ? JSON.parse(text) : null;
    }
    return {
      status: response.status,
      body,
      content_type: contentType,
    };
  }
  throw new Error("HTTP redirect limit exceeded");
}
