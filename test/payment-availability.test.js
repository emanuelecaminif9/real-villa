const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paymentsPublic, unavailablePages } = require('../payment-availability');

test('public payments fail closed unless explicitly enabled', () => {
  assert.equal(paymentsPublic({}), false);
  assert.equal(paymentsPublic({ PUBLIC_PAYMENTS_ENABLED: 'false' }), false);
  assert.equal(paymentsPublic({ PUBLIC_PAYMENTS_ENABLED: 'TRUE' }), true);
});

test('registration, shop and payment pages remain stored but are covered by the holding page', () => {
  for (const page of ['/iscrizioni.html', '/shop.html', '/pagamenti.html', '/checkout.html', '/i-miei-pagamenti.html']) {
    assert.equal(unavailablePages.has(page), true);
  }
});
