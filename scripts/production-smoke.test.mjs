import assert from 'node:assert/strict';
import { test } from 'node:test';

const productionUrl = process.env.PRODUCTION_URL;

if (!productionUrl) {
  throw new Error(
    'Set PRODUCTION_URL to your production origin, e.g. PRODUCTION_URL=https://crm.example.com npm run test:production'
  );
}

const baseUrl = new URL(productionUrl);

if (
  baseUrl.protocol !== 'https:' ||
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.pathname !== '/' ||
  baseUrl.search ||
  baseUrl.hash
) {
  throw new Error(
    'PRODUCTION_URL must be an HTTPS origin without a path or credentials.'
  );
}

async function request(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
}

test('homepage responds with HTML', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.notEqual(await response.text(), '');
});

test('login page responds with HTML', async () => {
  const response = await request('/login');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
});

test('unauthenticated dashboard access redirects to login', async () => {
  const response = await request('/dashboard', { redirect: 'manual' });
  const location = response.headers.get('location');

  assert.ok(
    response.status >= 300 && response.status < 400,
    `Expected a redirect, received HTTP ${response.status}`
  );
  assert.ok(location, 'Expected the redirect to include a Location header');

  const redirectUrl = new URL(location, baseUrl);
  assert.equal(redirectUrl.origin, baseUrl.origin);
  assert.equal(redirectUrl.pathname, '/login');
});

test('homepage includes baseline security headers', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('strict-transport-security') ?? '',
    /max-age=/i
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});
