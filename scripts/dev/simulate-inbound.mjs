#!/usr/bin/env node
/**
 * Simulate an inbound WhatsApp message against a local dev server.
 *
 * Development only. Its reason to exist is attribution: the `referral`
 * object that names the ad a lead came from only ever appears on a real
 * Click-to-WhatsApp click, so testing that path would otherwise mean
 * running a real ad, with real budget, through a public tunnel. This
 * posts the same payload Meta would, signed the same way.
 *
 * The webhook verifies `x-hub-signature-256` and fails closed, but in
 * dev we own the secret — so we can sign a payload ourselves.
 *
 * Usage:
 *   node scripts/dev/simulate-inbound.mjs --phone-number-id 123456789
 *   node scripts/dev/simulate-inbound.mjs --phone-number-id 123 \
 *     --from 51987654321 --name "Ana Torres" \
 *     --ad-id 120210000000000 --headline "Promo de verano"
 *
 * Flags:
 *   --phone-number-id  (required) must match a row in whatsapp_config
 *   --from             customer phone, digits only   [51987654321]
 *   --name             WhatsApp profile name         [Cliente de prueba]
 *   --text             message body                  [Hola, quiero información]
 *   --ad-id            send a Click-to-WhatsApp referral with this ad id
 *   --source-type      'ad' (paid) or 'post' (organic) [ad]
 *   --headline         ad headline shown in the CRM
 *   --wamid            override the message id (repeat one to test dedup)
 *   --url              webhook URL [http://localhost:3000/api/whatsapp/webhook]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith('--') ? (i += 1, next) : 'true';
  }
  return args;
}

/**
 * Read META_APP_SECRET from .env.local without pulling in a dotenv
 * dependency — this script must run with zero install.
 */
function readEnvLocal(key) {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const args = parseArgs(process.argv.slice(2));

const secret = process.env.META_APP_SECRET || readEnvLocal('META_APP_SECRET');
if (!secret) {
  console.error(
    'META_APP_SECRET is not set. Add it to .env.local (any string works\n' +
      'locally — it only has to match what the server verifies against).',
  );
  process.exit(1);
}

const phoneNumberId = args['phone-number-id'];
if (!phoneNumberId) {
  console.error(
    'Missing --phone-number-id. It must match a whatsapp_config row in\n' +
      'your local database, or the webhook will ignore the delivery.',
  );
  process.exit(1);
}

const from = args.from || '51987654321';
const name = args.name || 'Cliente de prueba';
const text = args.text || 'Hola, quiero información';
const url = args.url || 'http://localhost:3000/api/whatsapp/webhook';
// Unique per run so repeat invocations create new messages; pass --wamid
// explicitly to replay one and exercise the dedup path.
const wamid = args.wamid || `wamid.TEST${Date.now()}`;

const message = {
  from,
  id: wamid,
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: 'text',
  text: { body: text },
};

if (args['ad-id']) {
  // Shape per Meta's docs: the ad id arrives as referral.source_id.
  message.referral = {
    source_url: `https://fb.me/${args['ad-id']}`,
    source_id: args['ad-id'],
    source_type: args['source-type'] || 'ad',
    headline: args.headline || 'Anuncio de prueba',
    body: 'Texto principal del anuncio',
    media_type: 'image',
    ctwa_clid: `ctwa-${Date.now()}`,
  };
}

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_TEST',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '51999999999',
              phone_number_id: phoneNumberId,
            },
            contacts: [{ profile: { name }, wa_id: from }],
            messages: [message],
          },
        },
      ],
    },
  ],
};

// Sign the exact bytes we send — the route HMACs the raw body, so
// re-serialising after signing would break the signature.
const raw = JSON.stringify(payload);
const signature = crypto
  .createHmac('sha256', secret)
  .update(raw)
  .digest('hex');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': `sha256=${signature}`,
  },
  body: raw,
});

console.log(`${response.status} ${response.statusText}`, await response.text());
console.log(`  wamid:    ${wamid}`);
console.log(`  from:     ${from} (${name})`);
console.log(
  message.referral
    ? `  referral: ${message.referral.source_type} ${message.referral.source_id}`
    : '  referral: none (organic)',
);

if (!response.ok) process.exit(1);
