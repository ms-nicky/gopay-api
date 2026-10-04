import { GopayProvider } from 'merchantid';
import { config, ConfigError } from './config.js';
import { SessionStore } from './session.js';
import { JsonPaymentStore } from './store.js';
import { WebhookDispatcher } from './webhook.js';
import { normalizeLogger } from './logger.js';
import { renderQrPng, renderQrSvg } from './qr.js';

/**
 * Payment gateway QRIS di atas akun GoPay Merchant.
 *
 * Cara kerjanya: QRIS statis outlet diubah jadi QRIS dinamis per pesanan dengan
 * nominal unik (misal 50.000 menjadi 50.001), lalu feed transaksi merchant
 * dipolling untuk mencocokkan transfer yang masuk. GoPay Merchant tidak memberi
 * tahu pesanan mana yang dibayar, hanya nominalnya, jadi nominal unik itulah yang
 * membedakan satu order dari order lain.
 */
export class GoPayGateway {
  #provider;
  #payments;
  #webhook;
  #store;
  #sessionStore;
  #merchantId;
  #logger;

  constructor(options = {}) {
    const merchantId = options.merchantId ?? config.merchantId;
    if (!merchantId) {
      throw new ConfigError(
        'MERCHANT_ID belum diset. Jalankan `npm run login` lalu `npm run merchants` untuk discovering merchant id.',
      );
    }
    this.#merchantId = merchantId;
    this.#logger = normalizeLogger(options.logger);

    this.#store =
      options.store ?? new JsonPaymentStore(options.storeFile ?? './.data/payments.json');
    this.#sessionStore =
      options.sessionStore ??
      new SessionStore(
        options.sessionFile ?? config.sessionFile,
        options.sessionPassphrase ?? config.sessionPassphrase,
      );

    this.#provider = new GopayProvider({
      merchantId,
      session: options.session ?? this.#sessionStore.load() ?? undefined,
      staticQris: options.staticQris ?? config.staticQris,
      store: this.#store,
      payment: {
        pollIntervalMs: options.pollIntervalMs ?? config.pollIntervalMs,
        defaultExpiryMs: options.defaultExpiryMs ?? config.defaultExpiryMs,
        clockSkewMs: options.clockSkewMs ?? config.clockSkewMs,
        maxUniqueOffset: options.maxUniqueOffset ?? config.maxUniqueOffset,
      },
      onTokenRefreshed: async (refreshed) => {
        this.#sessionStore.save(refreshed);
      },
      logger: this.#logger,
    });

    if (!this.#provider.authenticated) {
      throw new ConfigError(
        'Belum terautentikasi. Jalankan `npm run login` dulu, atau pastikan file session ada.',
      );
    }

    this.#payments = this.#provider.payments();
    this.#webhook =
      options.webhook ??
      new WebhookDispatcher({
        url: options.webhookUrl ?? config.webhookUrl,
        secret: options.webhookSecret ?? config.webhookSecret,
        logger: this.#logger,
      });

    this.#wireEvents();
  }

  get provider() {
    return this.#provider;
  }

  get merchantId() {
    return this.#merchantId;
  }

  get store() {
    return this.#store;
  }

  get webhook() {
    return this.#webhook;
  }

  #wireEvents() {
    this.#payments.on('paid', (payment) => {
      this.#webhook.send('payment.paid', serializePayment(payment));
    });
    this.#payments.on('expired', (payment) => {
      this.#webhook.send('payment.expired', serializePayment(payment));
    });
  }

  /**
   * Buat pembayaran dan kembalikan QRIS dinamis plus nominal yang harus dibayar
   * pembeli. Pembeli wajib membayar persis `uniqueAmount`.
   */
  async createPayment({ amount, reference, expiresInMs, metadata }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ConfigError('amount harus bilangan bulat positif dalam rupiah');
    }

    const payment = await this.#provider.createPayment({ amount, reference, expiresInMs, metadata });
    return serializePayment(payment);
  }

  /**
   * Buat pembayaran sekaligus render QRIS-nya sebagai PNG atau SVG.
   *
   * Hasilnya menyertakan `qrPng`/`qrSvg` sebagai Buffer maupun string, jadi
   * pemanggil tidak perlu memanggil renderer terpisah.
   */
  async createPaymentWithImage(input = {}) {
    const payment = await this.createPayment(input);
    const { format = 'png', width, margin } = input;

    if (format === 'svg') {
      return { ...payment, qrSvg: await renderQrSvg(payment.qrString, { margin }) };
    }
    if (format === 'png') {
      return { ...payment, qrPng: await renderQrPng(payment.qrString, { width, margin }) };
    }

    throw new ConfigError(`format tidak dikenal: ${format}. Gunakan 'png' atau 'svg'.`);
  }

  async getPayment(id) {
    const payment = await this.#payments.getPayment(id);
    return payment ? serializePayment(payment) : null;
  }

  /**
   * Batalkan pembayaran yang masih pending.
   *
   * `PaymentService.cancelPayment` mengembalikan pembayaran existing bahkan
   * kalau statusnya sudah terminal. Supaya pemanggil tidak salah mengira
   * pembayarannya dibatalkan, status yang dikembalikan harus benar-benar
   * `cancelled`.
   */
  async cancelPayment(id) {
    const before = await this.#payments.getPayment(id);
    if (!before || before.status !== 'pending') return null;

    const payment = await this.#payments.cancelPayment(id);
    if (!payment || payment.status !== 'cancelled') return null;

    this.#webhook.send('payment.cancelled', serializePayment(payment));
    return serializePayment(payment);
  }

  /** Rekonsiliasi manual, untuk runtime tanpa timer persisten seperti Worker. */
  async tick() {
    const result = await this.#payments.tick();
    return {
      paid: result.paid.map(serializePayment),
      expired: result.expired.map(serializePayment),
    };
  }

  start() {
    this.#payments.start();
  }

  stop() {
    this.#payments.stop();
  }
}

/**
 * Bentuk serialisasi untuk API dan webhook.
 *
 * `qrString` disertakan karena inilah yang harus dirender ke pembeli, jadi
 * jangan pernah menulis payload ini ke log atau mengirimnya ke browser yang
 * tidak perlu — payload QRIS adalah kredensial pembayaran.
 */
export function serializePayment(payment) {
  return {
    id: payment.id,
    reference: payment.reference,
    status: payment.status,
    baseAmount: payment.baseAmount,
    uniqueOffset: payment.uniqueOffset,
    uniqueAmount: payment.uniqueAmount,
    qrString: payment.qrString,
    createdAt: new Date(payment.createdAt).toISOString(),
    expiresAt: new Date(payment.expiresAt).toISOString(),
    settledAt: payment.transaction?.settlementTime
      ? new Date(payment.transaction.settlementTime).toISOString()
      : null,
    transactionId: payment.transaction?.id ?? null,
    metadata: payment.metadata,
  };
}