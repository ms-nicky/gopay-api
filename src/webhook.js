import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pengirim webhook dengan tanda tangan HMAC-SHA256.
 *
 * GoPay Merchant tidak menyediakan webhook resmi, jadi status lunas hanya
 * diketahui lewat polling feed transaksi. Supaya sisi integrator tidak perlu
 * polling balik, gateway meneruskan perubahan status ke URL mereka sebagai
 * webhook bertanda tangan.
 *
 * Format body persis seperti yang dikirim, dan signature dihitung dari raw body
 * itu. Neverifikasi harus memakai `JSON.stringify(payload)` yang identik —
 * jangan parse lalu stringify ulang, karena urutan key bisa berubah.
 */
export class WebhookDispatcher {
  #url;
  #secret;
  #maxAttempts;
  #logger;

  constructor({ url, secret, maxAttempts = 5, logger = console }) {
    this.#url = url;
    this.#secret = secret;
    this.#maxAttempts = maxAttempts;
    this.#logger = logger;
  }

  get enabled() {
    return Boolean(this.#url && this.#secret);
  }

  sign(body) {
    return createHmac('sha256', this.#secret).update(body).digest('hex');
  }

  /**
   * Kirim webhook dengan backoff eksponensial: 1s, 2s, 4s, 8s, 16s.
   * Resolve hanya setelah 2xx; reject setelah semua percobaan gagal.
   */
  async send(event, payload) {
    if (!this.enabled) {
      this.#logger.warn?.(`Webhook dilewati (konfigurasi kosong): ${event}`);
      return false;
    }

    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
    const signature = this.sign(body);

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      try {
        const response = await fetch(this.#url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-event': event,
            'x-signature': signature,
            'x-attempt': String(attempt),
          },
          body,
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          this.#logger.log?.(`Webhook ${event} terkirim (percobaan ${attempt})`);
          return true;
        }

        this.#logger.warn?.(`Webhook ${event} ditolak: HTTP ${response.status}`);
      } catch (error) {
        this.#logger.warn?.(`Webhook ${event} gagal: ${error.message}`);
      }

      if (attempt < this.#maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      }
    }

    this.#logger.error?.(`Webhook ${event} gagal setelah ${this.#maxAttempts} percobaan`);
    return false;
  }
}

/**
 * Verifikasi webhook di sisi penerima.
 * Bandingkan dengan `timingSafeEqual` agar tahan timing attack.
 */
export function verifyWebhook(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}