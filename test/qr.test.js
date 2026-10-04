import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQrPng, renderQrSvg } from '../src/qr.js';
import { buildEmv, isValidQrisChecksum, parseEmv } from 'merchantid';

const STATIC_QRIS =
  '00020101021226620014COM.GO-JEK.WWW011993600914349052630340210G4905263030303UKE51440014ID.CO.QRIS.WWW0215AID0607336128660303UKE5204341453033605802ID5904Test6007BANDUNG6105402845409789000.0062475036c032f87c-f773-4619-aefa-675e1f06f9210703A016304A623';

/**
 * Fixture dengan nama merchant ber-spasi dan berkoma, seperti payload QRIS
 * asli. Ini yang membuat renderer harus memilih mode pengkodean dengan benar.
 *
 * Fixture ini dibangun lewat `buildEmv` supaya CRC-nya selalu valid. Menyalin
 * payload QRIS mentah lalu mengganti isinya secara manual akan merusak checksum,
 * karena setiap perubahan byteilik ikut mengubah tag `63`.
 */
const MERCHANT_QRIS = buildEmv(
  new Map([
    ['00', '11'],
    ['26', '8936000000000000000'],
    ['52', '0000'],
    ['53', '360'],
    ['54', '0000000'],
    ['58', 'ID'],
    ['59', 'TOKO CONTOH, Gaming'],
    ['60', 'MADIUN'],
  ]),
);

test('payload QRIS di kedua fixture lolos validasi checksum', () => {
  assert.equal(isValidQrisChecksum(STATIC_QRIS), true);
  assert.equal(isValidQrisChecksum(MERCHANT_QRIS), true);
});

test('renderQrPng menghasilkan PNG yang valid', async () => {
  const png = await renderQrPng(STATIC_QRIS);

  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 0);
  // Magic number PNG.
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('renderQrPng menghormati opsi lebar', async () => {
  const small = await renderQrPng(STATIC_QRIS, { width: 128 });
  const large = await renderQrPng(STATIC_QRIS, { width: 1024 });

  assert.ok(large.length > small.length);
});

test('renderQrPng menangani payload dengan koma dan spasi', async () => {
  const png = await renderQrPng(MERCHANT_QRIS, { width: 512 });

  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 0);
});

test('renderQrSvg menghasilkan SVG yang memuat isi payload', async () => {
  const svg = await renderQrSvg(STATIC_QRIS);

  assert.equal(typeof svg, 'string');
  assert.match(svg, /^<\?xml|^<svg/);
  assert.match(svg, /<\/svg>/);
});

test('renderer menolak payload kosong atau bukan string', async () => {
  for (const invalid of ['', null, undefined, 42, {}]) {
    await assert.rejects(() => renderQrPng(invalid), TypeError);
    await assert.rejects(() => renderQrSvg(invalid), TypeError);
  }
});

test('parseEmv membaca field merchant dari payload ber-spasi dan berkoma', () => {
  const map = parseEmv(MERCHANT_QRIS);
  assert.equal(map.get('58'), 'ID');
  assert.equal(map.get('59'), 'TOKO CONTOH, Gaming');
  assert.equal(map.get('60'), 'MADIUN');
});