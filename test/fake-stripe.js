const { randomUUID } = require('node:crypto');
function fakeStripe(clock) {
  const state = { customers: new Map(), sessions: new Map(), subs: new Map(), charges: [], updates: [], canceled: [], creates: 0, keys: new Map(), failCreateOnce: false, failUpdate: false };
  const copy = value => structuredClone(value);
  const id = prefix => prefix + randomUUID().replaceAll('-', '');
  const api = {
    prices: { retrieve: async () => ({ id: 'price_monthly', active: true, livemode: false, unit_amount: 5000, currency: 'eur', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, product: { active: true } }) },
    customers: {
      retrieve: async key => { if (!state.customers.has(key)) throw new Error('MissingCustomer'); return copy(state.customers.get(key)); },
      list: async ({ email, starting_after }) => ({ data: starting_after ? [] : [...state.customers.values()].filter(c => c.email === email).map(copy), has_more: false }),
      create: async (data, options) => {
        if (state.keys.has(options.idempotencyKey)) return copy(state.keys.get(options.idempotencyKey));
        const customer = { id: id('cus_'), livemode: false, ...data }; state.customers.set(customer.id, customer); state.keys.set(options.idempotencyKey, customer); return copy(customer);
      },
    },
    checkout: { sessions: {
      list: async ({ customer }) => ({ data: [...state.sessions.values()].filter(s => s.customer === customer).map(copy), has_more: false }),
      retrieve: async key => { if (!state.sessions.has(key)) throw new Error('MissingSession'); return copy(state.sessions.get(key)); },
      create: async (params, options) => {
        if (state.keys.has(options.idempotencyKey)) return copy(state.keys.get(options.idempotencyKey));
        state.creates++;
        const session = { id: id('cs_test_'), ...copy(params), status: 'open', payment_status: 'unpaid', amount_total: params.mode === 'subscription' ? 5000 : params.line_items.reduce((sum, i) => sum + i.quantity * i.price_data.unit_amount, 0), currency: 'eur', livemode: false };
        session.url = 'https://checkout.stripe.com/c/pay/' + session.id;
        state.sessions.set(session.id, session); state.keys.set(options.idempotencyKey, session);
        if (state.failCreateOnce) { state.failCreateOnce = false; throw new Error('SimulatedNetworkTimeout'); }
        return copy(session);
      },
    } },
    subscriptions: {
      retrieve: async key => { if (!state.subs.has(key)) throw new Error('MissingSubscription'); return copy(state.subs.get(key)); },
      list: async ({ customer, starting_after }) => ({ data: starting_after ? [] : [...state.subs.values()].filter(s => !customer || s.customer === customer).map(copy), has_more: false }),
      update: async (key, data) => { if (state.failUpdate) throw new Error('UpdateUnavailable'); state.updates.push({ key, ...copy(data) }); Object.assign(state.subs.get(key), data); return copy(state.subs.get(key)); },
      cancel: async (key, options) => { state.canceled.push({ key, ...options }); state.subs.get(key).status = 'canceled'; return copy(state.subs.get(key)); },
    },
    charges: { list: async ({ customer }) => ({ data: state.charges.filter(c => c.customer === customer).map(copy), has_more: false }) },
    billingPortal: { configurations: { retrieve: async key => ({ id: key, active: true, features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true } } }) }, sessions: { create: async () => ({ url: 'https://billing.stripe.com/p/session/test' }) } },
    webhooks: { constructEvent: () => { throw new Error('InvalidSignature'); } },
  };
  function paid(sessionId) {
    const session = state.sessions.get(sessionId); session.status = 'complete'; session.payment_status = 'paid';
    if (session.mode === 'subscription') {
      const subId = id('sub_'); session.subscription = subId;
      state.subs.set(subId, { id: subId, customer: session.customer, livemode: false, currency: 'eur', status: 'active', metadata: session.subscription_data.metadata,
        items: { data: [{ current_period_end: Math.floor(clock() / 1000) + 30 * 86400, price: { unit_amount: 5000 } }] }, cancel_at: null, pause_collection: null });
    }
    return copy(session);
  }
  return { api, state, paid };
}
module.exports = { fakeStripe };
