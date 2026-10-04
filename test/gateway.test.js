import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoPayGateway } from '../src/gateway.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * QRIS statis dari dokumentasi Midtrans, dipakai sebagai fixture.
 * Checksum-nya valid sehingga `staticToDynamicQris` bisa menurunkan QRIS dinamis.
 */
const STATIC_QRIS =
  '00020101021226620014COM.GO-JEK.WWW011993600914349052630340210G4905263030303UKE51440014ID.CO.QRIS.WWW0215AID0607336128660303UKE5204341453033605802ID5904Test6007BANDUNG6105402845409789000.0062475036c032f87c-f773-4619-aefa-675e1f06f9210703A016304A623';

function withGateway(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-gw-'));
  const gateway = new GoPayGateway({
    merchantId: 'G490526303',
    session: {
      tokens: {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3_600_000,
      },
      deviceId: 'device-test',
    },
    staticQris: STATIC_QRIS,
    storeFile: join(dir, 'payments.json'),
    logger: silent,
  });
  try {
    return fn(gateway);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('gateway menolak instantiated tanpa merchant id', () => {
  // merchantId dikosongkan secara eksplisit agar test tidak ikut terbaca dari .env.
  assert.throws(() => new GoPayGateway({ merchantId: '' }), /MERCHANT_ID/);
});

test('gateway menolak instantiated tanpa session', () => {
  assert.throws(
    () => new GoPayGateway({ merchantId: 'G1', sessionFile: '/tmp/opencode/tidak-ada.json' }),
    /Belum terautentikasi/,
  );
});

test('createPayment menghasilkan nominal unik dan QRIS dinamis', async () => {
  await withGateway(async (gateway) => {
    const payment = await gateway.createPayment({ amount: 50_000, reference: 'order-1' });

    assert.equal(payment.baseAmount, 50_000);
    assert.equal(payment.uniqueAmount, 50_000 + payment.uniqueOffset);
    assert.ok(payment.uniqueOffset > 0);
    assert.equal(payment.status, 'pending');
    assert.match(payment.qrString, /^0002/);
    assert.equal(payment.reference, 'order-1');
    assert.match(payment.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('dua pembayaran dengan nominal sama mendapat offset berbeda', async () => {
  await withGateway(async (gateway) => {
    const first = await gateway.createPayment({ amount: 50_000 });
    const second = await gateway.createPayment({ amount: 50_000 });

    assert.notEqual(first.uniqueAmount, second.uniqueAmount);
  });
});

test('createPayment menolak nominal bukan bilangan bulat positif', async () => {
  await withGateway(async (gateway) => {
    for (const amount of [0, -1, 1.5, '10000', null, undefined, Number.NaN]) {
      await assert.rejects(() => gateway.createPayment({ amount }), /bilangan bulat positif/);
    }
  });
});

test('getPayment mengembalikan null untuk id yang tidak dikenal', async () => {
  await withGateway(async (gateway) => {
    assert.equal(await gateway.getPayment('tidak-ada'), null);
  });
});

test('cancelPayment menandai pending menjadi cancelled dan idempoten', async () => {
  await withGateway(async (gateway) => {
    const payment = await gateway.createPayment({ amount: 25_000 });

    const cancelled = await gateway.cancelPayment(payment.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(await gateway.getPayment(payment.id).then((p) => p.status), 'cancelled');

    assert.equal(await gateway.cancelPayment(payment.id), null);
    assert.equal(await gateway.cancelPayment('tidak-ada'), null);
  });
});

test('nominal yang dibebaskan tidak langsung dipakai ulang order berikutnya', async () => {
  await withGateway(async (gateway) => {
    const first = await gateway.createPayment({ amount: 30_000 });
    await gateway.cancelPayment(first.id);

    // Slot yang baru dibebaskan masih dikuarantina karena transaksi lamanya
    // masih mungkin muncul di feed, jadi offset berikutnya harus berbeda.
    const second = await gateway.createPayment({ amount: 30_000 });
    assert.notEqual(second.uniqueAmount, first.uniqueAmount);
  });
});

test('payments tetap bertahan setelah gateway dibuat ulang', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-gw-'));
  const storeFile = join(dir, 'payments.json');
  const session = {
    tokens: {
      accessToken: 'token',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3_600_000,
    },
    deviceId: 'device-test',
  };

  try {
    const first = new GoPayGateway({
      merchantId: 'G490526303',
      session,
      staticQris: STATIC_QRIS,
      storeFile,
      logger: silent,
    });
    const payment = await first.createPayment({ amount: 77_000 });

    const second = new GoPayGateway({
      merchantId: 'G490526303',
      session,
      staticQris: STATIC_QRIS,
      storeFile,
      logger: silent,
    });

    const reloaded = await second.getPayment(payment.id);
    assert.equal(reloaded.uniqueAmount, payment.uniqueAmount);
    assert.equal(reloaded.status, 'pending');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('webhook terkirim saat pembayaran dilunasi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-gw-'));
  const received = [];

  try {
    const gateway = new GoPayGateway({
      merchantId: 'G490526303',
      session: {
        tokens: {
          accessToken: 'token',
          refreshToken: 'refresh',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3_600_000,
        },
        deviceId: 'device-test',
      },
      staticQris: STATIC_QRIS,
      storeFile: join(dir, 'payments.json'),
      logger: silent,
      webhook: {
        enabled: true,
        async send(event, payload) {
          received.push({ event, payload });
          return true;
        },
      },
    });

    const payment = await gateway.createPayment({ amount: 40_000 });
    const service = gateway.provider.payments();

    // Simulasikan rekonsiliasi: paksa pembayaran lunas lalu picu emit.
    await gateway.store.update({ ...gateway.store.get(payment.id), status: 'paid' });
    service.emit('paid', { ...gateway.store.get(payment.id), status: 'paid' });

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'payment.paid');
    assert.equal(received[0].payload.uniqueAmount, payment.uniqueAmount);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});