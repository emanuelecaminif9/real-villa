const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Stripe = require('stripe');
const { once } = require('node:events');
const { openDatabase } = require('../database');
const { createStripeBilling } = require('../stripe-billing');
const { fakeStripe } = require('./fake-stripe');

async function setup(t, { mailFailure = false, clock = Date.now } = {}) {
  const db = openDatabase(':memory:'); const fake = fakeStripe(Date.now); const mailbox = [];
  const env = { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake', AUTH_SECRET: 'test-only-private-secret-'.repeat(4), ADMIN_EMAILS: 'staff@example.test', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test' };
  const billing = createStripeBilling({ db, env, clock, stripe: fake.api, sendMail: async mail => { mailbox.push(mail); if (mailFailure) throw new Error('private-provider-error'); } });
  const app = express(); billing.installWebhook(app); app.use(express.json()); billing.installRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); env.BASE_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  async function request(path, body, cookie = '', headers = {}) {
    const res = await fetch(env.BASE_URL + path, { headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: env.BASE_URL, 'X-RV-Request': '1' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, cookie: res.headers.get('set-cookie'), cache: res.headers.get('cache-control') };
  }
  async function login(email = 'parent@example.test') {
    const challenge = await request('/api/account/request-code', { email }); assert.equal(challenge.status, 200);
    const code = mailbox.at(-1).text.match(/\b\d{8}\b/)[0];
    const result = await request('/api/account/verify-code', { challenge: challenge.data.challenge, code }); assert.equal(result.status, 200);
    return { ...result, challenge: challenge.data.challenge, code, cookie: result.cookie.split(';')[0] };
  }
  return { db, fake, env, billing, request, login, mailbox };
}
test('protected history/admin endpoints reject anonymous requests and invented cookies', async t => {
  const f = await setup(t);
  for (const path of ['/api/account/overview', '/api/account/history?customer=cus_a', '/api/account/orders', '/api/admin/overview']) {
    assert.equal((await f.request(path)).status, 401); assert.equal((await f.request(path, undefined, 'rv_session=' + 'a'.repeat(64))).status, 401);
  }
});
test('public config exposes both registration methods and explicit preview, never keys or unauthenticated history', async t => {
  const f = await setup(t, { clock: () => Date.parse('2026-08-28T12:00:00Z') });
  Object.assign(f.env, { SANDBOX_EARLY_REGISTRATION: 'true', LIVE_PAYMENTS_ENABLED: 'false', SEASON_ID: '2026-2027',
    BILLING_POLICY: 'calendar_full_months_day8', PAYMENT_TERMS_VERSION: 'sandbox-v4', PAYMENT_TERMS_APPROVED: 'true', STRIPE_SUBSCRIPTION_PRICE_ID: 'price_monthly' });
  const result = await f.request('/api/billing/config');
  assert.equal(result.status, 200); assert.equal(result.data.sandboxCalendarPreview, true);
  assert.equal(result.data.dueNow, 10000); assert.deepEqual(result.data.paymentMethods, ['card', 'paypal']);
  assert.equal(result.cache, 'no-store'); assert.doesNotMatch(JSON.stringify(result.data), /sk_test_|whsec_|AUTH_SECRET/);
  assert.equal((await f.request('/api/account/history?customer=cus_a')).status, 401);
  f.env.LIVE_PAYMENTS_ENABLED = 'true'; assert.equal((await f.request('/api/billing/config')).status, 503);
});
test('CSRF checks reject foreign origins and missing custom header', async t => {
  const f = await setup(t);
  assert.equal((await f.request('/api/account/request-code', { email: 'x@example.test' }, '', { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.request('/api/account/request-code', { email: 'x@example.test' }, '', { 'X-RV-Request': '' })).status, 403);
  assert.equal(f.mailbox.length, 0);
});
test('one-time code grants an HttpOnly session; replay fails and logout revokes it', async t => {
  const f = await setup(t); const auth = await f.login();
  assert.equal((await f.request('/api/account/me', undefined, auth.cookie)).data.account.email, 'parent@example.test');
  assert.equal((await f.request('/api/account/verify-code', { challenge: auth.challenge, code: auth.code })).status, 401);
  const row = f.db.prepare('SELECT * FROM rv_challenges WHERE id=?').get(auth.challenge); assert.notEqual(row.code_hash, auth.code); assert.equal(row.consumed, 1);
  assert.equal((await f.request('/api/account/logout', {}, auth.cookie)).status, 200);
  assert.equal((await f.request('/api/account/me', undefined, auth.cookie)).data.account, null);
});
test('five incorrect code attempts lock the challenge, even if the next code is correct', async t => {
  const f = await setup(t); const start = await f.request('/api/account/request-code', { email: 'parent@example.test' });
  const code = f.mailbox.at(-1).text.match(/\b\d{8}\b/)[0];
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/account/verify-code', { challenge: start.data.challenge, code: '00000000' })).status, 401);
  assert.equal((await f.request('/api/account/verify-code', { challenge: start.data.challenge, code })).status, 401);
  assert.equal(f.db.prepare('SELECT attempts FROM rv_challenges').get().attempts, 5);
});
test('email code requests are rate limited per email', async t => {
  const f = await setup(t);
  for (let i = 0; i < 3; i++) assert.equal((await f.request('/api/account/request-code', { email: 'parent@example.test' })).status, 200);
  assert.equal((await f.request('/api/account/request-code', { email: 'parent@example.test' })).status, 429);
});
test('failed email delivery consumes its code and never grants access or leaks provider details', async t => {
  const f = await setup(t, { mailFailure: true });
  const result = await f.request('/api/account/request-code', { email: 'parent@example.test' });
  assert.equal(result.status, 503); assert.equal(result.data.challenge, undefined);
  assert.doesNotMatch(JSON.stringify(result.data), /private-provider-error|\b\d{8}\b/);
  const row = f.db.prepare('SELECT * FROM rv_challenges').get(); assert.equal(row.consumed, 1);
  const code = f.mailbox[0].text.match(/\b\d{8}\b/)[0];
  assert.equal((await f.request('/api/account/verify-code', { challenge: row.id, code })).status, 401);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rv_sessions').get().n, 0);
});
test('verified parent cannot read another customer’s payments or open their portal', async t => {
  const f = await setup(t); const auth = await f.login(); f.fake.state.customers.set('cus_other', { id: 'cus_other', livemode: false, email: 'other@example.test' });
  assert.equal((await f.request('/api/account/history?customer=cus_other', undefined, auth.cookie)).status, 404);
  assert.equal((await f.request('/api/account/portal', { customer: 'cus_other' }, auth.cookie)).status, 404);
});
test('only allowlisted, email-verified staff can see secretariat data', async t => {
  const f = await setup(t); const auth = await f.login();
  assert.equal((await f.request('/api/admin/overview', undefined, auth.cookie)).status, 403);
  const staff = await f.login('staff@example.test'); assert.equal((await f.request('/api/admin/overview', undefined, staff.cookie)).status, 200);
});
test('unsafe legacy cancellation is disabled without contacting Stripe', async t => {
  const f = await setup(t);
  assert.equal((await f.request('/api/subscriptions/cancel', { email: 'parent@example.test', telefono: '3331234567' })).status, 410);
  assert.equal(f.fake.state.updates.length, 0); assert.equal(f.fake.state.canceled.length, 0);
});
test('cancellation checks ownership and current snapshot; never extends season end', async t => {
  const f = await setup(t); const auth = await f.login(); const now = Math.floor(Date.now() / 1000);
  f.fake.state.customers.set('cus_parent', { id: 'cus_parent', email: 'parent@example.test', livemode: false });
  f.fake.state.customers.set('cus_other', { id: 'cus_other', email: 'other@example.test', livemode: false });
  const sub = { id: 'sub_parent', customer: 'cus_parent', livemode: false, status: 'active', cancel_at: now + 86400, items: { data: [{ current_period_end: now + 86400 * 20 }] } };
  f.fake.state.subs.set(sub.id, sub); f.fake.state.subs.set('sub_other', { ...sub, id: 'sub_other', customer: 'cus_other' });
  assert.equal((await f.request('/api/account/subscriptions/sub_other/cancel', { confirm: true }, auth.cookie)).status, 404);
  assert.equal((await f.request('/api/account/subscriptions/sub_parent/cancel', { confirm: true, version: 'stale' }, auth.cookie)).status, 409);
  const result = await f.request('/api/account/subscriptions/sub_parent/cancel', { confirm: true, version: f.billing.subscriptionView(sub).version }, auth.cookie);
  assert.equal(result.status, 200); assert.equal(result.data.subscription.cancelAt, now + 86400); assert.equal(f.fake.state.updates.at(-1).proration_behavior, 'none');
});
test('all Stripe customer profiles for verified email are visible without merging', async t => {
  const f = await setup(t); const auth = await f.login();
  for (const id of ['cus_first', 'cus_second']) f.fake.state.customers.set(id, { id, email: 'parent@example.test', livemode: false });
  const result = await f.request('/api/account/overview', undefined, auth.cookie); assert.equal(result.status, 200); assert.equal(result.data.profiles.length, 2);
  assert.equal(f.fake.state.creates, 0);
});
test('portal rejects configurations that allow plan changes or unbounded cancellation', async t => {
  const f = await setup(t); const auth = await f.login(); f.fake.state.customers.set('cus_parent', { id: 'cus_parent', email: 'parent@example.test', livemode: false });
  f.fake.api.billingPortal.configurations.retrieve = async () => ({ active: true, features: { subscription_update: { enabled: true } } });
  assert.equal((await f.request('/api/account/portal', { customer: 'cus_parent' }, auth.cookie)).status, 503);
});
test('signed webhook uses raw body; invalid signature rejected, processing failures retryable', async t => {
  const f = await setup(t); const sdk = new Stripe('sk_test_fake'); f.fake.api.webhooks = sdk.webhooks;
  const event = { id: 'evt_http', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_missing' } } };
  assert.equal((await f.request('/stripe/webhook', event)).status, 400);
  const signature = sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: f.env.STRIPE_WEBHOOK_SECRET });
  assert.equal((await f.request('/stripe/webhook', event, '', { 'Stripe-Signature': signature })).status, 503);
  event.type = 'unrelated.event'; event.id = 'evt_ignored';
  const sig = sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: f.env.STRIPE_WEBHOOK_SECRET });
  assert.equal((await f.request('/stripe/webhook', event, '', { 'Stripe-Signature': sig })).status, 200);
});
