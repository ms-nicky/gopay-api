import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/session.js';

function withTempFile(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-session-'));
  try {
    return fn(join(dir, 'session.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const session = { accessToken: 'rahasia', refreshToken: 'rahasia2', expiresAt: 123 };

test('session tersimpan dan dibaca kembali tanpa passphrase', () => {
  withTempFile((path) => {
    new SessionStore(path).save(session);
    assert.deepEqual(new SessionStore(path).load(), session);
  });
});

test('session terenkripsi tidak terbaca sebagai plaintext di file', () => {
  withTempFile((path) => {
    new SessionStore(path, 'passphrase').save(session);

    const raw = readFileSync(path, 'utf8');
    assert.equal(raw.includes('rahasia'), false);
    assert.deepEqual(new SessionStore(path, 'passphrase').load(), session);
  });
});

test('passphrase salah membuat load gagal', () => {
  withTempFile((path) => {
    new SessionStore(path, 'benar').save(session);
    assert.throws(() => new SessionStore(path, 'salah').load());
  });
});

test('file session hanya bisa dibaca pemilik', () => {
  withTempFile((path) => {
    new SessionStore(path).save(session);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});

test('load mengembalikan null saat file belum ada', () => {
  withTempFile((path) => {
    assert.equal(new SessionStore(path).load(), null);
    assert.equal(new SessionStore(path).exists(), false);
  });
});

test('clear menghapus file session', () => {
  withTempFile((path) => {
    const store = new SessionStore(path);
    store.save(session);
    store.clear();
    assert.equal(store.exists(), false);
  });
});