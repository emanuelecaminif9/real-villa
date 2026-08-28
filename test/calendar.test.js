const { test } = require('node:test');
const assert = require('node:assert/strict');
const { season, registrationQuote } = require('../billing-config');

const env = { SEASON_ID: '2026-2027', BILLING_POLICY: 'calendar_full_months_day8',
  PAYMENT_TERMS_VERSION: 'calendar-test', PAYMENT_TERMS_APPROVED: 'true',
  STRIPE_EXPECTED_MONTHLY_CENTS: '5000', STRIPE_REGISTRATION_FEE_CENTS: '5000' };
function quote(at, overrides = {}) {
  const clock = () => Date.parse(at); return registrationQuote(season({ ...env, ...overrides }, clock), clock);
}
const iso = seconds => new Date(seconds * 1000).toISOString();
const earlySandbox = { SANDBOX_EARLY_REGISTRATION: 'true', STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fake', LIVE_PAYMENTS_ENABLED: 'false' };

test('explicit Sandbox opening simulates September while keeping real time and October first renewal', () => {
  const result = quote('2026-08-28T12:00:00+02:00', earlySandbox);
  assert.equal(result.sandboxCalendarPreview, true); assert.equal(result.paidMonth, '2026-09');
  assert.equal(result.dueNow, 10000); assert.equal(result.renewals.length, 8);
  assert.equal(iso(result.firstRenewalAt), '2026-10-08T08:00:00.000Z');
  assert.equal(iso(result.quoteValidUntil), '2026-08-31T22:00:00.000Z');
});
test('early test flag fails closed with live credentials, mode, activation or missing explicit safety values', () => {
  for (const override of [{ STRIPE_MODE: 'live' }, { STRIPE_SECRET_KEY: 'sk_live_fake' },
    { LIVE_PAYMENTS_ENABLED: 'true' }, { LIVE_PAYMENTS_ENABLED: undefined }, { STRIPE_MODE: undefined }, { STRIPE_SECRET_KEY: '' }])
    assert.throws(() => quote('2026-08-28T12:00:00Z', { ...earlySandbox, ...override }), error => error.status === 503);
});
test('Sandbox override cannot reopen a closed season or change late-entry rules', () => {
  assert.throws(() => quote('2027-06-01T12:00:00Z', earlySandbox), /chiuse/);
  const december = quote('2026-12-20T12:00:00Z', earlySandbox);
  assert.equal(december.sandboxCalendarPreview, false); assert.equal(december.paidMonth, '2026-12');
  assert.equal(december.renewals.length, 5);
});
test('test preview consent expires at September opening and cannot silently become real enrollment', () => {
  const preview = quote('2026-08-28T12:00:00Z', earlySandbox);
  const opened = quote('2026-09-01T12:00:00Z', earlySandbox);
  assert.equal(opened.sandboxCalendarPreview, false);
  assert.notEqual(preview.consentVersion, opened.consentVersion);
});

test('20 September: 50 registration + 50 September, then eight full monthly payments', () => {
  const result = quote('2026-09-20T12:00:00+02:00');
  assert.equal(result.registrationAmount, 5000); assert.equal(result.currentMonthAmount, 5000);
  assert.equal(result.dueNow, 10000); assert.equal(result.paidMonth, '2026-09');
  assert.deepEqual(result.renewals.map(r => r.month), ['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04','2027-05']);
  assert.equal(iso(result.firstRenewalAt), '2026-10-08T08:00:00.000Z');
  assert.equal(iso(result.lastPaymentAt), '2027-05-08T08:00:00.000Z');
  assert.equal(result.dueNow + result.renewals.reduce((n, r) => n + r.amount, 0), 50000);
});
for (const day of ['01', '07', '08', '20', '30']) {
  test(`September ${day}: the paid entry month is not charged again on day 8`, () => {
    const result = quote(`2026-09-${day}T10:00:00+02:00`);
    assert.equal(result.dueNow, 10000); assert.equal(result.renewals.length, 8);
    assert.equal(result.renewals[0].month, '2026-10');
  });
}
for (const [month, remaining] of [['2026-10',7],['2026-11',6],['2026-12',5],['2027-01',4],['2027-02',3],['2027-03',2],['2027-04',1],['2027-05',0]]) {
  test(`${month}: entry month in full, no charge for earlier months, ${remaining} future renewals`, () => {
    const result = quote(month + '-20T12:00:00+02:00');
    assert.equal(result.dueNow, 10000); assert.equal(result.paidMonth, month);
    assert.equal(result.renewals.length, remaining);
    assert.ok(result.renewals.every(r => r.month > month && r.month <= '2027-05' && r.amount === 5000));
    assert.equal(result.checkoutMode, remaining ? 'subscription' : 'payment');
  });
}
test('May is a one-time payment, with no empty subscription or June renewal', () => {
  const result = quote('2027-05-20T12:00:00+02:00');
  assert.equal(result.firstRenewalAt, null); assert.equal(result.checkoutMode, 'payment');
  assert.deepEqual(result.renewals, []); assert.equal(result.dueNow, 10000);
});
test('full May charge ends exactly at next Stripe period boundary, not at a partial period', () => {
  const result = quote('2026-09-20T12:00:00+02:00');
  assert.equal(iso(result.end), '2027-06-08T08:00:00.000Z');
  assert.equal(iso(result.enrollmentEndsAt), '2027-05-31T22:00:00.000Z');
  assert.equal(result.end - result.lastPaymentAt, 31 * 86400);
});
test('billing days remain day 8 in Rome across both daylight-saving transitions', () => {
  const result = quote('2026-09-01T12:00:00+02:00');
  for (const r of result.renewals) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' }).formatToParts(new Date(r.at * 1000));
    assert.equal(parts.find(p => p.type === 'day').value, '08');
    assert.ok(!['06','07','08'].includes(parts.find(p => p.type === 'month').value));
  }
});
test('registration stays closed before September even with the obsolete preseason flag', () => {
  for (const value of [undefined, 'false', 'true'])
    assert.throws(() => quote('2026-08-28T12:00:00+02:00', { PRESEASON_REGISTRATION_ENABLED: value }),
      error => error.status === 409 && /aprono il 1° settembre 2026/.test(error.message));
});
test('registration opens exactly at September 1 midnight in Rome with 100 upfront', () => {
  assert.throws(() => quote('2026-08-31T21:59:59.999Z'), /aprono il 1° settembre/);
  const result = quote('2026-08-31T22:00:00.000Z');
  assert.equal(result.dueNow, 10000); assert.equal(result.paidMonth, '2026-09');
  assert.equal(result.currentMonthAmount, 5000); assert.equal(result.renewals.length, 8);
  assert.equal(iso(result.firstRenewalAt), '2026-10-08T08:00:00.000Z');
});
test('the entry month changes at Rome midnight, not the server UTC midnight', () => {
  const before = quote('2026-09-30T21:59:00Z'); const after = quote('2026-09-30T22:00:00Z');
  assert.equal(before.paidMonth, '2026-09'); assert.equal(after.paidMonth, '2026-10');
  assert.notEqual(before.consentVersion, after.consentVersion);
  assert.equal(iso(before.quoteValidUntil), '2026-09-30T22:00:00.000Z');
});
test('quote/consent remains stable within a month, but includes the registration amount', () => {
  const first = quote('2026-09-01T12:00:00Z'); const later = quote('2026-09-20T12:00:00Z');
  assert.equal(first.consentVersion, later.consentVersion);
  assert.notEqual(first.consentVersion, quote('2026-09-20T12:00:00Z', { STRIPE_REGISTRATION_FEE_CENTS: '6000' }).consentVersion);
});
test('season closes at June 1 Rome midnight and never silently renews next September', () => {
  for (const date of ['2027-05-31T22:00:00Z','2027-06-08T12:00:00Z','2027-09-08T12:00:00Z'])
    assert.throws(() => quote(date), /chiuse/);
});
test('invalid season, negative fee and old unapproved policy are rejected', () => {
  for (const overrides of [{ SEASON_ID: '2026-2028' }, { STRIPE_REGISTRATION_FEE_CENTS: '-1' }, { BILLING_POLICY: 'anniversary_prorated_end' }, { PAYMENT_TERMS_APPROVED: 'false' }])
    assert.throws(() => quote('2026-09-20T12:00:00Z', overrides));
});
