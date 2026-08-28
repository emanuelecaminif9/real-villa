const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, REALVILLA_TEST: '1' };
// Never load a developer's real credentials or send email/payment traffic in tests.
for (const key of Object.keys(env)) if (/^(STRIPE_|PAYPAL_|SMTP_|RESEND_|AUTH_|MAIL_|SEASON_|PRESEASON_|BILLING_|PAYMENT_|PAYMENTS_|LIVE_PAYMENTS_|ADMIN_|BASE_URL$|RENDER)/.test(key)) delete env[key];
for (const folder of ['', 'public', 'scripts', 'test']) {
  for (const name of readdirSync(path.join(root, folder)).filter(n => n.endsWith('.js'))) {
    const run = spawnSync(process.execPath, ['--check', path.join(root, folder, name)], { env, stdio: 'inherit' }); if (run.status !== 0) process.exit(run.status || 1);
  }
}
const tests = readdirSync(path.join(root, 'test')).filter(n => n.endsWith('.test.js')).map(n => path.join('test', n));
for (const args of [['--test', '--test-concurrency=1', ...tests], ['scripts/smoke-test.js']]) {
  const run = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' }); if (run.status !== 0) process.exit(run.status || 1);
}
