# gopay-api

Payment gateway QRIS di atas akun **GoPay Merchant** (GoBiz). Mengubah QRIS statis
menjadi QRIS dinamis per pesanan, lalu mendeteksi pembayaran secara otomatis dari
feed transaksi merchant.

GoPay Merchant tidak menyediakan webhook resmi maupun endpoint "cek status" publik.
Feed transaksi hanya memberi tahu **nominal** yang masuk, bukan pesanan mana yang
dibayar. Karena itu setiap pembayaran diberi nominal unik (misal 50.000 menjadi
50.001) dan pembelinya wajib membayar persis.

> Klien tidak resmi. Pakai hanya untuk akun merchant milik Anda sendiri.
> Jangan menyimpan token, OTP, atau payload QRIS di log maupun repository.

## Prasyarat

- Node.js 18 atau lebih baru
- Akun **GoPay Merchant** (daftar di app GoFood Merchant: KTP, rekening atas nama,
  outlet aktif)
- QRIS statis outlet Anda

## Memulai

```bash
npm install
cp .env.example .env

npm run login      # login OTP, session disimpan
npm run whoami     # tampilkan merchant + QRIS statis untuk disalin ke .env
```

Isi `MERCHANT_ID` dan `STATIC_QRIS` di `.env` dari output `whoami`, lalu jalankan
server:

```bash
npm start
```

## Konfigurasi

| Variabel | Keterangan |
|---|---|
| `MERCHANT_ID` | Id merchant GoBiz, format `G000000001` |
| `STATIC_QRIS` | Payload QRIS statis outlet |
| `SESSION_FILE` | Lokasi file kredensial (default `./.data/session.json`) |
| `SESSION_PASSPHRASE` | Kalau diset, session dienkripsi AES-256-GCM |
| `WEBHOOK_URL` | Target notifikasi `paid`/`expired`/`cancelled` |
| `WEBHOOK_SECRET` | Kunci HMAC-SHA256 untuk tanda tangan webhook |
| `API_KEY` | Kalau diset, endpoint mewajibkan header `x-api-key` |
| `PORT` | Port REST API (default 3000) |
| `POLL_INTERVAL_MS` | Interval polling feed (default 5000) |
| `DEFAULT_EXPIRY_MS` | Masa berlaku pembayaran (default 300000 = 5 menit) |
| `CLOCK_SKEW_MS` | Toleransi keterlambatan feed (default 60000) |
| `MAX_UNIQUE_OFFSET` | Batas pembayaran konkuren per nominal dasar (default 999) |

## Endpoint REST

```bash
# Buat pembayaran
curl -X POST localhost:3000/payments \
  -H 'content-type: application/json' \
  -d '{"amount":50000,"reference":"inv-001"}'
```

```json
{
  "id": "pay_mutznvwvr7yhiu",
  "reference": "inv-001",
  "status": "pending",
  "baseAmount": 50000,
  "uniqueOffset": 1,
  "uniqueAmount": 50001,
  "qrString": "00020101021226620014COM.GO-JEK.WWW...",
  "createdAt": "2026-10-04T15:40:54.763Z",
  "expiresAt": "2026-10-04T15:45:54.763Z",
  "settledAt": null,
  "transactionId": null
}
```

Renderkan `qrString` ke pembeli. Tampilkan `uniqueAmount` sebagai nominal yang
harus dibayar, bukan `baseAmount`.

| Method | Path | Keterangan |
|---|---|---|
| `POST` | `/payments` | Buat pembayaran, kembalikan QRIS |
| `GET` | `/payments/:id` | Status satu pembayaran |
| `POST` | `/payments/:id/cancel` | Batalkan yang masih pending |
| `GET` | `/health` | Health check |

## Webhook

Gateway mengirim notifikasi bertanda tangan setiap kali status berubah:

```
POST <WEBHOOK_URL>
content-type: application/json
x-event: payment.paid
x-signature: <hex hmac-sha256 dari raw body>
x-attempt: 1

{"event":"payment.paid","sentAt":"...","data":{...}}
```

Verifikasi di sisi penerima dengan **raw body** persis seperti dikirim:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const raw = await readRawBody(req);
const expected = createHmac('sha256', secret).update(raw).digest('hex');
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-signature']));
```

`x-signature` dihitung dari raw body, jadi jangan parse lalu stringify ulang —
urutan key bisa berubah dan signature jadi tidak cocok. Failed delivery diulang
hingga 5 kali dengan backoff 1s, 2s, 4s, 8s, 16s.

Event yang dikirim: `payment.paid`, `payment.expired`, `payment.cancelled`.

## Pemakaian sebagai library

```js
import { GoPayGateway } from 'gopay-api';

const gateway = new GoPayGateway();
gateway.start();

const payment = await gateway.createPayment({ amount: 50_000, reference: 'inv-001' });
console.log(payment.qrString, payment.uniqueAmount);
```

Untuk runtime tanpa timer persisten (Cloudflare Workers, Lambda), jangan panggil
`start()`. Panggil `tick()` dari scheduler platform:

```js
const { paid, expired } = await gateway.tick();
```

## Catatan desain

**Nominal unik.** Offset dialokasikan dari slot yang belum dipakai. Slot yang
baru dibebaskan tetap dikuarantina selama `2 * CLOCK_SKEW_MS`, karena transaksi
lama masih bisa muncul di feed. Tanpa kuarantina, satu transfer bisa melunasi
dua pesanan.

**Matchmaking sebelum expiry.** Feed mengindeks transaksi dengan jeda, jadi
pembayar yang membayar tepat waktu bisa baru muncul setelah `expiresAt` terlewat.
Pencocokan selalu jalan lebih dulu sebelum penandaan kedaluwarsa.

**Store persisten.** `JsonPaymentStore` menulis ke disk dengan pola
write-tempfile lalu rename. `InMemoryPaymentStore` bawaan `merchantid` hilang
saat restart, dan itu membuat slot nominal yang sudah dialokasikan terbuang —
sumber duplikasi pembayaran.

**Multi-proses.** Penguncian di `merchantid` hanya berlaku satu proses. Kalau
menjalankan lebih dari satu instance, uniqueness harus dijamin di level database,
misalnya unique index pada nominal untuk baris yang masih aktif.

## Command

```bash
npm start        # jalankan REST API
npm run login    # login OTP
npm run whoami   # status session + QRIS statis
npm run merchants # daftar merchant
npm test         # unit test
```

## License

MIT