import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebhookDispatcher, verifyWebhook } from '../src/webhook.js';

const silent = { log() {}, warn() {}, error() {} };

test('signature yang dikirim diverifikasi oleh fungsi verifikasi', () => {
  const secret = 'rahasia-anton';
  const body = JSON.stringify({ event: 'payment.paid', data: { id: 'abc' } });
  const dispatcher = new WebhookDispatcher({ url: 'http://x', secret });

  const signature = dispatcher.sign(body);
  assert.equal(verifyWebhook(body, signature, secret), true);
});

test('body yang diubah setelah ditandatangani gagal diverifikasi', () => {
  const secret = 'kunci';
  const dispatcher = new WebhookDispatcher({ url: 'http://x', secret });
  const signature = dispatcher.sign(JSON.stringify({ amount: 10000 }));
  assert.equal(verifyWebhook(JSON.stringify({ amount: 1 }), signature, secret), false);
});

test('verifikasi menolak signature salah, panjangnya tidak cocok, atau kosong', () => {
  assert.equal(verifyWebhook('{}', 'a'.repeat(64), 'kunci'), false);
  assert.equal(verifyWebhook('{}', 'pendek', 'kunci'), false);
  assert.equal(verifyWebhook('{}', '', 'kunci'), false);
  assert.equal(verifyWebhook('{}', 'a'.repeat(64), ''), false);
});

test('webhook nonaktif bila url atau secret kosong', async () => {
  const dispatcher = new WebhookDispatcher({ url: '', secret: '' });
  assert.equal(dispatcher.enabled, false);
  assert.equal(await dispatcher.send('payment.paid', {}), false);
});

test('send() mencoba ulang sampai server memberi 2xx', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: calls >= 3, status: calls >= 3 ? 200 : 500 };
  };

  try {
    const dispatcher = new WebhookDispatcher({
      url: 'http://localhost/hook',
      secret: 'kunci',
      logger: silent,
    });
    assert.equal(await dispatcher.send('payment.paid', { id: 'x' }), true);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('send() mengembalikan false setelah semua percobaan gagal', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  try {
    const dispatcher = new WebhookDispatcher({
      url: 'http://localhost/hook',
      secret: 'kunci',
      maxAttempts: 2,
      logger: silent,
    });
    assert.equal(await dispatcher.send('payment.expired', {}), false);
  } finally {
    globalThis.fetch = original;
  }
});