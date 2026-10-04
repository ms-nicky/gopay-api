import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, handleWebhook } from '../src/server.js';
import { GoPayGateway } from '../src/gateway.js';
import { createHmac } from 'node:crypto';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

const STATIC_QRIS =
  '00020101021226620014COM.GO-JEK.WWW011993600914349052630340210G4905263030303UKE51440014ID.CO.QRIS.WWW0215AID0607336128660303UKE5204341453033605802ID5904Test6007BANDUNG6105402845409789000.0062475036c032f87c-f773-4619-aefa-675e1f06f9210703A016304A623';

async function withServer(fn, { apiKey, webhookSecret } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-srv-'));
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

  const server = createApp({ gateway, logger: silent, apiKey, webhookSecret });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    return await fn({ base, gateway });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /health melaporkan merchant dan status polling', async () => {
  await withServer(async ({ base, gateway }) => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.merchantId, gateway.merchantId);
    assert.equal(body.polling, false);
  });
});

test('POST /payments membuat pembayaran dan mengembalikan QRIS', async () => {
  await withServer(async ({ base }) => {
    const response = await post(base, '/payments', { amount: 50_000, reference: 'inv-1' });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.status, 'pending');
    assert.equal(body.reference, 'inv-1');
    assert.equal(body.uniqueAmount, 50_000 + body.uniqueOffset);
    assert.match(body.qrString, /^0002/);
  });
});

test('GET /payments/:id mengembalikan pembayaran yang dibuat', async () => {
  await withServer(async ({ base }) => {
    const created = await (await post(base, '/payments', { amount: 12_000 })).json();
    const body = await (await fetch(`${base}/payments/${created.id}`)).json();

    assert.equal(body.id, created.id);
    assert.equal(body.uniqueAmount, created.uniqueAmount);
  });
});

test('GET /payments/:id untuk id asing membalas 404', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/payments/tidak-ada`);
    assert.equal(response.status, 404);
  });
});

test('POST /payments/:id/cancel membatalkan lalu 404 pada percobaan ulang', async () => {
  await withServer(async ({ base }) => {
    const created = await (await post(base, '/payments', { amount: 15_000 })).json();

    const first = await fetch(`${base}/payments/${created.id}/cancel`, { method: 'POST' });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, 'cancelled');

    const second = await fetch(`${base}/payments/${created.id}/cancel`, { method: 'POST' });
    assert.equal(second.status, 404);
  });
});

test('POST /payments menolak amount yang bukan angka', async () => {
  await withServer(async ({ base }) => {
    const response = await post(base, '/payments', { amount: 'lima puluh ribu' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_amount');
  });
});

test('POST /payments menolak body JSON rusak dengan 400', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bukan json',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_body');
  });
});

test('rute yang tidak dikenal membalas 404', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/tidak-ada`)).status, 404);
  });
});

test('API key menolak request tanpa header yang benar', async () => {
  await withServer(
    async ({ base }) => {
      assert.equal((await fetch(`${base}/payments`)).status, 401);

      const wrong = await fetch(`${base}/payments`, { headers: { 'x-api-key': 'salah' } });
      assert.equal(wrong.status, 401);

      const right = await fetch(`${base}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'kunci' },
        body: JSON.stringify({ amount: 1000 }),
      });
      assert.equal(right.status, 201);
    },
    { apiKey: 'kunci' },
  );
});

test('health dan receiver webhook tetap terbuka saat API key aktif', async () => {
  await withServer(
    async ({ base }) => {
      assert.equal((await fetch(`${base}/health`)).status, 200);
      // Tanpa signature, receiver menolak payload-nya sendiri dengan 401.
      assert.equal((await fetch(`${base}/webhooks/verify`, { method: 'POST' })).status, 401);

      const raw = JSON.stringify({ event: 'payment.paid' });
      const signature = createHmac('sha256', 'kunci-rahasia').update(raw).digest('hex');
      const accepted = await fetch(`${base}/webhooks/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': signature },
        body: raw,
      });
      assert.equal(accepted.status, 200);
    },
    { apiKey: 'kunci', webhookSecret: 'kunci-rahasia' },
  );
});

test('handleWebhook menerima signature yang benar dan menolak yang salah', () => {
  const secret = 'kunci-rahasia';
  const payload = { event: 'payment.paid', data: { id: 'pay_1', uniqueAmount: 50_001 } };
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');

  const ok = handleWebhook(raw, signature, secret);
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.data.uniqueAmount, 50_001);

  assert.equal(handleWebhook(raw, 'a'.repeat(64), secret).ok, false);
  assert.equal(handleWebhook('{"diubah":true}', signature, secret).ok, false);
});