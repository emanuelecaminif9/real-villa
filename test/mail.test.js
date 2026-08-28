const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mailConfiguration, createMailDelivery } = require('../mail-delivery');
const env = { MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_fake_only_for_tests', MAIL_FROM: 'Real Villa <onboarding@resend.dev>' };
const message = { to: 'parent@example.test', subject: 'Codice', text: 'Codice di prova 12345678' };

test('Resend sends via fixed HTTPS endpoint and does not require SMTP on Render Free', async () => {
  let call;
  const send = createMailDelivery({ env, fetch: async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ id: 'email_test' }) }; } });
  await send(message, 'challenge_test');
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.options.method, 'POST'); assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers['Idempotency-Key'], 'rv-login-challenge_test');
  assert.deepEqual(JSON.parse(call.options.body), { from: env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text });
  assert.ok(call.options.signal instanceof AbortSignal);
});
test('provider failure is generic and does not expose the API key or response text', async () => {
  const send = createMailDelivery({ env, fetch: async () => ({ ok: false, json: async () => ({ message: 'secret response ' + env.RESEND_API_KEY }) }) });
  await assert.rejects(send(message, 'test'), error => error.message === 'EmailDeliveryFailed' && !error.message.includes(env.RESEND_API_KEY));
});
test('email is not considered sent when provider acknowledgement is missing', async () => {
  const send = createMailDelivery({ env, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(send(message, 'test'), /Unconfirmed/);
});
test('invalid provider, missing credentials and header injection are rejected', () => {
  for (const values of [{}, { ...env, RESEND_API_KEY: '' }, { ...env, MAIL_PROVIDER: 'unknown' }, { ...env, MAIL_FROM: 'x\r\nBcc: other' }])
    assert.throws(() => mailConfiguration(values));
});
test('live mode cannot use the limited resend.dev test sender', () => {
  assert.throws(() => mailConfiguration({ ...env, STRIPE_MODE: 'live' }), /mittente della società/);
});
test('existing SMTP deployments retain TLS verification and bounded timeouts', async () => {
  let config; let delivered;
  const smtpEnv = { MAIL_PROVIDER: 'smtp', MAIL_FROM: 'club@example.test', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'test', SMTP_PASS: 'test' };
  const send = createMailDelivery({ env: smtpEnv, createTransport: options => { config = options; return { sendMail: async mail => { delivered = mail; } }; } });
  await send(message, 'test'); assert.equal(config.port, 587); assert.equal(config.requireTLS, true);
  assert.notEqual(config.tls?.rejectUnauthorized, false); assert.equal(config.socketTimeout, 15000);
  assert.equal(delivered.from, smtpEnv.MAIL_FROM);
});
