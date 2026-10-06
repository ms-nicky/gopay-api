import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoPayGateway, serializePayment } from './gateway.js';
import { config } from './config.js';
import { verifyWebhook } from './webhook.js';
import { renderQrPng } from './qr.js';

/**
 * REST API untuk payment gateway.
 *
 * Endpoint:
 *   GET    /                  halaman kasir
 *   POST   /payments          buat pembayaran, kembalikan QRIS
 *   GET    /payments          daftar pembayaran terbaru
 *   GET    /payments/:id      status satu pembayaran
 *   GET    /payments/:id/qr.png
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

      // Halaman kasir. File statis dibaca dari disk, bukan dibundel, supaya
      // perubahan markup langsung terlihat tanpa rebuild.
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return sendFile(res, WEB_DIR, 'index.html');
      }

      if (req.method === 'GET' && url.pathname === '/app.js') {
        return sendFile(res, WEB_DIR, 'app.js');
      }

      if (req.method === 'GET' && url.pathname === '/hero.js') {
        return sendFile(res, WEB_DIR, 'hero.js');
      }

      if (req.method === 'GET' && url.pathname === '/hero.mp4') {
        return sendFile(res, WEB_DIR, 'hero.mp4');
      }

      if (req.method === 'GET' && url.pathname === '/style.css') {
        return sendFile(res, WEB_DIR, 'style.css');
      }

      if (req.method === 'GET' && url.pathname === '/payments') {
        const semua = gateway.store.all();
        const urut = [...semua].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return json(res, 200, urut.map(serializePayment));
      }

      const paymentMatch = url.pathname.match(/^\/payments\/([^/]+)$/);
      if (req.method === 'GET' && paymentMatch) {
        const payment = await gateway.getPayment(paymentMatch[1]);
        return payment ? json(res, 200, payment) : json(res, 404, { error: 'not_found' });
      }

      const qrMatch = url.pathname.match(/^\/payments\/([^/]+)\/qr\.png$/);
      if (req.method === 'GET' && qrMatch) {
        const payment = await gateway.getPayment(qrMatch[1]);
        if (!payment) return json(res, 404, { error: 'not_found' });
        const png = await renderQrPng(payment.qrString, { width: 640 });
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': png.length,
          'cache-control': 'no-store',
        });
        return res.end(png);
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

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/**
 * Kirim satu file statis dari `dir`.
 *
 * `normalize` dipakai supaya `..` di path tidak bisa keluar dari `dir`. Nama
 * file sudah dicek ke daftar Route di atas, tapi tetap dibatasi di sini supaya
 * fungsi ini aman kalau nanti dipakai ulang.
 */
function sendFile(res, dir, name) {
  const target = join(dir, normalize(name));
  if (!target.startsWith(dir)) return json(res, 400, { error: 'bad_path' });

  let body;
  try {
    body = readFileSync(target);
  } catch {
    return json(res, 404, { error: 'not_found' });
  }

  res.writeHead(200, {
    'content-type': MIME[extname(target)] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
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