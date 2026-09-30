/**
 * Mock Meta Graph API for manual testing — `npm run mock:meta`.
 *
 * Point the app at it (META_GRAPH_BASE_URL=http://localhost:4010 in
 * .env.local, restart `npm run dev`) and campaign sends go here instead
 * of WhatsApp: fast, free, no real messages. Every OTHER Graph call
 * (channel verify, template sync, media…) is forwarded to the real
 * graph.facebook.com, so the rest of the app keeps working.
 *
 * Behaves like Cloud API under load: 80–300 ms latency, a per-number
 * throughput cap (130429 above it), and error injection you can change
 * while it runs:
 *
 *   curl localhost:4010/__mock                       # show settings + counters
 *   curl -X POST localhost:4010/__mock -d '{"cap":600}'
 *   curl -X POST localhost:4010/__mock -d '{"err5xx":5,"errRecipient":2,"errReset":1}'
 *   curl -X POST localhost:4010/__mock -d '{"failCode":132015,"failTemplate":"promo_a"}'   # "pause" a template
 *   curl -X POST localhost:4010/__mock -d '{"failCode":190}'                             # expired token → channel stops
 *   curl -X POST localhost:4010/__mock -d '{"failCode":135000}'                          # (#135000) Generic user error
 *   curl -X POST localhost:4010/__mock -d '{"holdQuality":10}'                           # 10 % held_for_quality_assessment
 *   curl -X POST localhost:4010/__mock -d '{"reset":true}'                               # back to defaults
 *
 * Percentages are 0–100. `failCode` makes every matching send fail with
 * that Meta code (optionally only for `failTemplate` / `failNumber`).
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_META_PORT ?? 4010);
const REAL = 'https://graph.facebook.com';

const DEFAULTS = {
  cap: 1000, // msg/s per phone number before 130429
  latencyMin: 80,
  latencyMax: 300,
  err5xx: 0,
  errRecipient: 0,
  errReset: 0,
  failCode: 0,
  failTemplate: '',
  failNumber: '',
  /** % of accepted sends returned as message_status held_for_quality_assessment. */
  holdQuality: 0,
};
let cfg = { ...DEFAULTS };
const counters = {
  accepted: 0,
  throttled: 0,
  failed: 0,
  reset: 0,
  forwarded: 0,
};
const windows = new Map<string, number[]>();
const perSecond: number[] = [];
let thisSecond = 0;
setInterval(() => {
  perSecond.push(thisSecond);
  if (perSecond.length > 60) perSecond.shift();
  thisSecond = 0;
}, 1000);

const ERRORS: Record<number, string> = {
  130429: 'Rate limit hit',
  131026: 'Message undeliverable',
  131049:
    'This message was not delivered to maintain healthy ecosystem engagement',
  132015: 'Template is paused',
  132016: 'Template is disabled',
  132001: 'Template name does not exist in the translation',
  190: 'Error validating access token: Session has expired',
  131000: 'Something went wrong',
  368: 'Temporarily blocked for policies violations',
  135000: '(#135000) Generic user error',
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
const metaError = (res: http.ServerResponse, code: number, status = 400) =>
  json(res, status, {
    error: {
      code,
      message: ERRORS[code] ?? `Error ${code}`,
      type: 'OAuthException',
      fbtrace_id: 'mock',
    },
  });

async function forward(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer
) {
  counters.forwarded++;
  try {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (
        typeof v === 'string' &&
        !['host', 'connection', 'content-length'].includes(k)
      )
        headers[k] = v;
    }
    const r = await fetch(`${REAL}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET')
        ? undefined
        : new Uint8Array(body),
    });
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') ?? 'application/json',
    });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    json(res, 502, {
      error: { message: `mock forward failed: ${(err as Error).message}` },
    });
  }
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = req.url ?? '/';

    if (url.startsWith('/__mock')) {
      if (req.method === 'POST') {
        try {
          const patch = JSON.parse(body.toString() || '{}');
          cfg = patch.reset ? { ...DEFAULTS } : { ...cfg, ...patch };
          if (patch.reset)
            Object.keys(counters).forEach(
              (k) => (counters[k as keyof typeof counters] = 0)
            );
        } catch {
          return json(res, 400, { error: 'invalid JSON' });
        }
      }
      return json(res, 200, {
        settings: cfg,
        counters,
        lastSecondsSent: perSecond.slice(-10),
      });
    }

    // POST /v21.0/{phone_number_id}/messages → mock; everything else → real Meta.
    const m = /^\/v[\d.]+\/([^/?]+)\/messages/.exec(url);
    if (req.method !== 'POST' || !m) return void forward(req, res, body);

    const pnid = m[1];
    let payload: { to?: string; template?: { name?: string } } = {};
    try {
      payload = JSON.parse(body.toString());
    } catch {
      /* keep empty */
    }
    const now = Date.now();
    const w = (windows.get(pnid) ?? []).filter((t) => now - t < 1000);
    w.push(now);
    windows.set(pnid, w);

    const latency =
      cfg.latencyMin + Math.random() * (cfg.latencyMax - cfg.latencyMin);
    setTimeout(() => {
      if (w.length > cfg.cap) {
        counters.throttled++;
        return metaError(res, 130429);
      }
      if (
        cfg.failCode &&
        (!cfg.failTemplate || payload.template?.name === cfg.failTemplate) &&
        (!cfg.failNumber || pnid === cfg.failNumber)
      ) {
        counters.failed++;
        return metaError(res, cfg.failCode, cfg.failCode === 190 ? 401 : 400);
      }
      const r = Math.random() * 100;
      if (r < cfg.errReset) {
        counters.reset++;
        return req.socket.destroy();
      }
      if (r < cfg.errReset + cfg.err5xx) {
        counters.failed++;
        return metaError(res, 131000, 500);
      }
      if (r < cfg.errReset + cfg.err5xx + cfg.errRecipient) {
        counters.failed++;
        return metaError(res, 131026);
      }
      counters.accepted++;
      thisSecond++;
      json(res, 200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: payload.to, wa_id: payload.to }],
        messages: [
          {
            id: `wamid.MOCK${now}${counters.accepted}`,
            message_status:
              Math.random() * 100 < cfg.holdQuality
                ? 'held_for_quality_assessment'
                : 'accepted',
          },
        ],
      });
    }, latency);
  });
});

server.listen(PORT, () => {
  console.log(`Mock Meta Graph API on http://localhost:${PORT}`);
  console.log('  sends:   POST /v*/{phone_number_id}/messages (mocked)');
  console.log('  other:   forwarded to graph.facebook.com');
  console.log(`  control: curl localhost:${PORT}/__mock`);
  setInterval(() => {
    if (thisSecond || perSecond.at(-1)) {
      console.log(
        `sent/s ${String(perSecond.at(-1) ?? 0).padStart(5)}  total ${counters.accepted}  throttled ${counters.throttled}  failed ${counters.failed}  reset ${counters.reset}`
      );
    }
  }, 1000);
});

export {};
