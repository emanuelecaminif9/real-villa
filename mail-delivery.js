const nodemailer = require('nodemailer');
const { PublicError } = require('./billing-config');

function mailConfiguration(env = process.env) {
  const provider = env.MAIL_PROVIDER || 'smtp';
  if (!env.MAIL_FROM || /[\r\n]/.test(env.MAIL_FROM)) throw new PublicError('Mittente email non configurato.', 503);
  if (env.STRIPE_MODE === 'live' && /@resend\.dev(?:>|\s|$)/i.test(env.MAIL_FROM))
    throw new PublicError('Per il live serve un mittente della società verificato, non quello di prova.', 503);
  if (provider === 'resend') {
    if (!String(env.RESEND_API_KEY || '').startsWith('re_')) throw new PublicError('Servizio email HTTPS non configurato.', 503);
    return { provider };
  }
  if (provider !== 'smtp') throw new PublicError('Servizio email non riconosciuto.', 503);
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port) || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)
    throw new PublicError('Servizio email SMTP non configurato.', 503);
  return { provider, port };
}

function createMailDelivery({ env = process.env, fetch: sendFetch = globalThis.fetch, createTransport = nodemailer.createTransport } = {}) {
  let transport;
  return async (message, requestId) => {
    const config = mailConfiguration(env);
    if (config.provider === 'resend') {
      const response = await sendFetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'rv-login-' + requestId },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      });
      // Provider bodies can contain addresses or secrets: never echo or log them.
      if (!response.ok) throw new Error('EmailDeliveryFailed');
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id) throw new Error('EmailDeliveryUnconfirmed');
      return;
    }
    transport ||= createTransport({
      host: env.SMTP_HOST, port: config.port, secure: config.port === 465, requireTLS: true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
  };
}
module.exports = { mailConfiguration, createMailDelivery };
