import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

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

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpRequestDependencies {
  fetch?: FetchLike;
  lookup?: (host: string) => Promise<readonly string[]>;
  signal?: AbortSignal;
}

const SECRET_HEADER = /^(authorization|cookie|proxy-authorization|x-api-key)$/i;

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
  const mapped = raw.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIp(mapped[1]);
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
  return (
    raw === "::" ||
    raw === "::1" ||
    raw.startsWith("fc") ||
    raw.startsWith("fd") ||
    /^fe[89ab]/.test(raw) ||
    raw.startsWith("ff") ||
    raw.startsWith("2001:db8:")
  );
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
): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await lookup(host);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateOrReservedIp(address))
  ) {
    throw new Error("HTTP request target is not publicly routable");
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTTP_RESPONSE_BYTES) {
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

export async function executeHttpRequest(
  config: HttpRequestConfig,
  dependencies: HttpRequestDependencies = {},
): Promise<HttpRequestOutput> {
  const fetcher = dependencies.fetch ?? fetch;
  const lookup =
    dependencies.lookup ??
    (async (host: string) =>
      (await dnsLookup(host, { all: true })).map((result) => result.address));
  let url = parseAndAssertHttpUrl(config.url);
  const headers = config.headers ?? {};

  for (let redirect = 0; redirect <= MAX_HTTP_REDIRECTS; redirect += 1) {
    await assertPublicRuntimeTarget(url, lookup);
    const response = await fetcher(url.toString(), {
      method: config.method,
      headers,
      body:
        config.method === "GET" || config.method === "DELETE"
          ? undefined
          : config.body,
      redirect: "manual",
      signal: dependencies.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("HTTP redirect is missing location");
      if (redirect === MAX_HTTP_REDIRECTS) {
        throw new Error("HTTP redirect limit exceeded");
      }
      url = parseAndAssertHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
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
