import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonPaymentStore } from '../src/store.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-store-'));
  try {
    return fn(join(dir, 'payments.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scope = { provider: 'gopay', merchantId: 'G000000001' };

test('create lalu get mengembalikan pembayaran yang sama', () => {
  withTempDir((path) => {
    const store = new JsonPaymentStore(path);
    const payment = { id: 'p1', status: 'pending', uniqueAmount: 10001, scope };
    store.create(payment);

    assert.equal(store.get('p1').uniqueAmount, 10001);
    assert.equal(store.get('tidak-ada'), undefined);
  });
});

test('listActive hanya mengembalikan yang pending', () => {
  withTempDir((path) => {
    const store = new JsonPaymentStore(path);
    store.create({ id: 'p1', status: 'pending', uniqueAmount: 10001, scope });
    store.create({ id: 'p2', status: 'paid', uniqueAmount: 10002, scope });
    store.create({ id: 'p3', status: 'expired', uniqueAmount: 10003, scope });

    const active = store.listActive(scope);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'p1');
  });
});

test('listActive memfilter berdasarkan scope', () => {
  withTempDir((path) => {
    const store = new JsonPaymentStore(path);
    store.create({ id: 'p1', status: 'pending', uniqueAmount: 10001, scope });
    store.create({
      id: 'p2',
      status: 'pending',
      uniqueAmount: 10002,
      scope: { provider: 'gopay', merchantId: 'G999999999' },
    });

    assert.equal(store.listActive(scope).length, 1);
    assert.equal(store.listActive().length, 2);
  });
});

test('pembayaran bertahan setelah store dibuat ulang dari file yang sama', async () => {
  withTempDir(async (path) => {
    const first = new JsonPaymentStore(path);
    await first.create({ id: 'p1', status: 'pending', uniqueAmount: 10001, scope });

    const second = new JsonPaymentStore(path);
    assert.equal(second.get('p1').uniqueAmount, 10001);
  });
});

test('file rusak tidak membuat store gagal saat start', () => {
  withTempDir((path) => {
    const first = new JsonPaymentStore(path);
    first.create({ id: 'p1', status: 'pending', uniqueAmount: 10001, scope });
    first.update({ ...first.get('p1'), status: 'paid' });

    const broken = new JsonPaymentStore(path);
    assert.deepEqual(broken.all(), []);
  });
});

test('update menimpa status pembayaran', () => {
  withTempDir((path) => {
    const store = new JsonPaymentStore(path);
    store.create({ id: 'p1', status: 'pending', uniqueAmount: 10001, scope });
    store.update({ id: 'p1', status: 'paid', uniqueAmount: 10001, scope, transactionId: 'tx-1' });

    assert.equal(store.get('p1').status, 'paid');
    assert.equal(store.get('p1').transactionId, 'tx-1');
  });
});

test('penulisan bersamaan tidak menimpa satu sama lain', async () => {
  withTempDir(async (path) => {
    const store = new JsonPaymentStore(path);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.create({ id: `p${i}`, status: 'pending', uniqueAmount: 20000 + i, scope }),
      ),
    );

    const reloaded = new JsonPaymentStore(path);
    assert.equal(reloaded.all().length, 20);
  });
});