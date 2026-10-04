import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { GoPayGateway } from './gateway.js';
import { config } from './config.js';
import { verifyWebhook } from './webhook.js';

/**
 * REST API untuk payment gateway.
 *
 * Endpoint:
 *   POST   /payments          buat pembayaran, kembalikan QRIS
 *   GET    /payments/:id      status satu pembayaran
 *   POST   /payments/:id/cancel
 *   GET    /health
 *   POST   /webhooks/verify  contoh receiver untuk menguji signature
 */
export function createApp({
  gateway,
  logger = console,
  apiKey = config.apiKey,
  webhookSecret = config.webhookSecret,
}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (!authorize(req, url, apiKey)) {
        return json(res, 401, { error: 'unauthorized' });
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, {
          status: 'ok',
          merchantId: gateway.merchantId,
          webhookConfigured: gateway.webhook.enabled,
          polling: gateway.provider.payments().isRunning,
        });
      }

      if (req.method === 'POST' && url.pathname === '/payments') {
        let body;
        try {
          body = await readJson(req);
        } catch (error) {
          return json(res, 400, { error: 'invalid_body', message: error.message });
        }
        if (typeof body.amount !== 'number') {
          return json(res, 400, { error: 'invalid_amount', message: 'amount wajib diisi sebagai angka' });
        }
        const payment = await gateway.createPayment({
          amount: body.amount,
          reference: body.reference,
          expiresInMs: body.expiresInMs,
          metadata: body.metadata,
        });
        logger.log?.(`Pembayaran ${payment.id} dibuat: ${payment.uniqueAmount}`);
        return json(res, 201, payment);
      }

      const paymentMatch = url.pathname.match(/^\/payments\/([^/]+)$/);
      if (req.method === 'GET' && paymentMatch) {
        const payment = await gateway.getPayment(paymentMatch[1]);
        return payment ? json(res, 200, payment) : json(res, 404, { error: 'not_found' });
      }

      const cancelMatch = url.pathname.match(/^\/payments\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancelMatch) {
        const payment = await gateway.cancelPayment(cancelMatch[1]);
        return payment ? json(res, 200, payment) : json(res, 404, { error: 'not_found' });
      }

      // Contoh receiver: comeback dari Gateway ke aplikasi pemanggil. Verifikasi
      // signature dulu, baru parse payload.
      if (req.method === 'POST' && url.pathname === '/webhooks/verify') {
        const raw = await readRaw(req);
        if (!webhookSecret) {
          return json(res, 500, { error: 'webhook_not_configured' });
        }
        let result;
        try {
          result = handleWebhook(raw, req.headers['x-signature'], webhookSecret);
        } catch {
          result = { ok: false, error: 'invalid_json' };
        }
        return result.ok
          ? json(res, 200, { ok: true, payload: result.payload })
          : json(res, 401, { error: result.error });
      }

      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      logger.error?.(`Kesalahan pada ${req.method} ${url.pathname}:`, error);
      return json(res, 500, { error: 'internal_error', message: error.message });
    }
  });
}

/**
 * Endpoint publik dibiarkan terbuka supaya `/webhooks/verify` dan `/health`
 * bisa dipakai sebagai receiver contoh tanpa API key.
 */
function authorize(req, url, apiKey) {
  if (!apiKey) return true;
  if (url.pathname.startsWith('/webhooks/') || url.pathname === '/health') return true;

  const provided = req.headers['x-api-key'];
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(apiKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req) {
  try {
    return JSON.parse(await readRaw(req));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('body bukan JSON yang valid');
    throw error;
  }
}

/**
 * Baca body sebagai raw string. Diperlukan oleh verifikasi webhook karena
 * signature dihitung atas byte persis seperti yang dikirim, bukan atas hasil
 * parse yang sudah di-serialize ulang.
 */
async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('body terlalu besar');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Helper untuk sisi penerima webhook: verifikasi signature lalu parse payload.
 * Ambil raw body apa adanya, jangan stringify ulang hasil parse.
 */
export function handleWebhook(rawBody, signature, secret) {
  if (!verifyWebhook(rawBody, signature, secret)) {
    return { ok: false, error: 'invalid_signature' };
  }
  return { ok: true, payload: JSON.parse(rawBody) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gateway = new GoPayGateway();
  gateway.start();
  createApp({ gateway }).listen(config.port, () => {
    console.log(`gopay-api listening di :${config.port}`);
    console.log(`Merchant ${gateway.merchantId}`);
    if (!gateway.webhook.enabled) {
      console.warn('Webhook nonaktif: isi WEBHOOK_URL dan WEBHOOK_SECRET di .env');
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      gateway.stop();
      process.exit(0);
    });
  }
}