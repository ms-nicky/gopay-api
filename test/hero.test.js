import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitungKurva, harusLepas, dariRoda, dariSentuh, pasangHero } from '../web/hero.js';

test('judul memudar di progress awal, tagline muncul di akhir', () => {
  assert.equal(hitungKurva(0).judul, 1);
  assert.equal(hitungKurva(0).tagline, 0);

  assert.ok(hitungKurva(0.5).judul < 0.1);
  assert.ok(hitungKurva(0.5).tagline < 0.1);

  assert.ok(hitungKurva(0.9).tagline > 0.3);
  assert.equal(hitungKurva(1).tagline, 1);
});

test('nilai kurva tidak pernah keluar dari 0..1', () => {
  for (const p of [-1, 0, 0.5, 1, 2]) {
    const k = hitungKurva(p);
    assert.ok(k.judul >= 0 && k.judul <= 1, `judul di ${p}: ${k.judul}`);
    assert.ok(k.tagline >= 0 && k.tagline <= 1, `tagline di ${p}: ${k.tagline}`);
    assert.ok(k.bar >= 0 && k.bar <= 1, `bar di ${p}: ${k.bar}`);
  }
});

test('video sedikit zoom saat advance, tidak lebih dari 6 persen', () => {
  assert.equal(hitungKurva(0).video, 1);
  assert.ok(Math.abs(hitungKurva(1).video - 1.06) < 1e-9);
});

/**
 * Release valve adalah perbaikan utama terhadap sumber komponennya yang
 * mengunci halaman seumur hidup sehingga form kasir tak pernah bisa disentuh.
 */
test('lock hanya lepas setelah progress penuh dan user masih menggulir ke bawah', () => {
  assert.equal(harusLepas(1, 120), true);
  assert.equal(harusLepas(1, -120), false);

  // Masih di tengah video: candidata tidak lepas meski scroll ke bawah.
  assert.equal(harusLepas(0.5, 120), false);
  assert.equal(harusLepas(0.98, 120), false);

  // Sudah penuh tapi user justru menggulir balik ke atas untuk mengulang.
  assert.equal(harusLepas(1, 0), false);
});

test('arah roda dan sentuhan sudah dinormalisasi ke arah yang sama', () => {
  // Roda: deltaY positif berarti ke bawah.
  assert.ok(dariRoda(120) > 0);
  assert.ok(dariRoda(-120) < 0);

  // Sentuh: clientY turun berarti jari ke atas, halaman根本 bergulir ke bawah.
  assert.ok(dariSentuh(40) > 0);
  assert.ok(dariSentuh(-40) < 0);
});

/**
 * Tanpa `src`, komponen tidak memasang listener apa pun. Root di sini sengaja
 * tidak punya `addEventListener` supaya test gagal keras kalau suatu saat
 * listener tetap dipasang di jalur statis ini.
 */
test('tanpa video, komponen tidak memasang listener scroll sama sekali', () => {
  const kelas = [];
  const root = {
    querySelector: () => null,
    classList: { add: (k) => kelas.push(k) },
  };

  const lepas = pasangHero(root);
  assert.deepEqual(kelas, ['hero--statis']);
  assert.equal(typeof lepas, 'function');
  lepas();
});

test('pasangHero menerima root kosong tanpa melempar', () => {
  assert.doesNotThrow(() => pasangHero(null)());
});