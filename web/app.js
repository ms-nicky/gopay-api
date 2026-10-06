const el = (id) => document.getElementById(id);

const formBuat = el('form-buat');
const inputNominal = el('input-nominal');
const inputRef = el('input-ref');
const errorNominal = el('error-nominal');
const tombolBuat = el('tombol-buat');
const statusBuat = el('status-buat');

const panelKosong = el('panel-kosong');
const panelMuat = el('panel-muat');
const panelGagal = el('panel-gagal');
const panelHasil = el('panel-hasil');
const pesanGagal = el('pesan-gagal');
const tombolCoba = el('tombol-coba');

const gambarQris = el('gambar-qris');
const nominalBayar = el('nominal-bayar');
const nominalAsli = el('nominal-asli');
const statusBayar = el('status-bayar');
const batasBayar = el('batas-bayar');
const barisTransaksi = el('baris-transaksi');
const idTransaksi = el('id-transaksi');
const tombolBatal = el('tombol-batal');
const statusAksi = el('status-aksi');

const daftarRiwayat = el('daftar-riwayat');
const riwayatKosong = el('riwayat-kosong');

let pembayaranAktif = null;
let timerPolling = null;
let timerHitung = null;
let nominalTerakhirDibuat = null;

/** Pemisah ribuan Indonesia: 10000 jadi "10.000". */
function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID').format(angka);
}

/** Ambil digit saja dari input, lalu abaikan pemisah ribuan yang diketik user. */
function parseNominal(nilai) {
  const digit = nilai.replace(/\D/g, '');
  if (!digit) return NaN;
  return Number.parseInt(digit, 10);
}

function tampilkan(state) {
  panelKosong.hidden = state !== 'kosong';
  panelMuat.hidden = state !== 'muat';
  panelGagal.hidden = state !== 'gagal';
  panelHasil.hidden = state !== 'hasil';
}

/**
 * Status dari API selalu bahasa Inggris, jadi pemetaannya di satu tempat saja.
 * Panel pembayaran aktif dan riwayat harus memakai fungsi yang sama, kalau tidak
 * satu halaman bisa menampilkan `lunas` di baris atas dan `paid` di riwayat.
 */
const LABEL_STATUS = {
  pending: 'menunggu',
  paid: 'lunas',
  expired: 'kedaluwarsa',
  cancelled: 'dibatalkan',
};

const labelStatus = (status) => LABEL_STATUS[status] ?? status;

function warnaiStatus(el, status) {
  el.className = 'status';
  if (status === 'paid') el.classList.add('status--lunas');
  if (status === 'expired' || status === 'cancelled') el.classList.add('status--gagal');
}

function setStatusBayar(status) {
  statusBayar.textContent = labelStatus(status);
  warnaiStatus(statusBayar, status);
}

/**
 * Waktu selalu dalam WIB, bukan timezone browser.
 *
 * Server menyimpan UTC, jadi tanpa `timeZone` jam yang tampil ikut berubah
 * sesuai tempat laptop dibuka. Untuk kasir yang membandingkan jam bayar dengan
 * mutasi rekening, selisih satu jam itu membingungkan.
 */
function formatWaktu(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Kode `error` dari API, kalau `message` tidak ada. */
const LABEL_ERROR = {
  unauthorized: 'API key ditolak.',
  invalid_body: 'Isi permintaan tidak valid.',
  invalid_amount: 'Nominal tidak valid.',
  invalid_json: 'Isi permintaan bukan JSON.',
  not_found: 'Pembayaran tidak ditemukan.',
  webhook_not_configured: 'Webhook belum dikonfigurasi.',
  bad_path: 'Alamat tidak valid.',
  internal_error: 'Terjadi kesalahan di server.',
};

async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body.message ?? LABEL_ERROR[body.error] ?? `Permintaan gagal (${response.status}).`,
    );
  }
  return body;
}

function tampilkanHasil(pembayaran) {
  pembayaranAktif = pembayaran;

  nominalBayar.textContent = `Rp ${formatRupiah(pembayaran.uniqueAmount)}`;

  const selisih = pembayaran.uniqueAmount - pembayaran.baseAmount;
  nominalAsli.textContent =
    selisih === 0
      ? 'Tidak ada selisih.'
      : `Pesan Rp ${formatRupiah(pembayaran.baseAmount)}, pembayaran persis Rp ${formatRupiah(pembayaran.uniqueAmount)} agar tidak tertukar dengan order lain.`;

  setStatusBayar(pembayaran.status);
  barisTransaksi.hidden = !pembayaran.transactionId;
  idTransaksi.textContent = pembayaran.transactionId ?? '';

  gambarQris.src = `/payments/${encodeURIComponent(pembayaran.id)}/qr.png`;
  gambarQris.alt = `QRIS untuk pembayaran Rp ${formatRupiah(pembayaran.uniqueAmount)}`;

  tampilkan('hasil');
  tombolBatal.hidden = pembayaran.status !== 'pending';

  mulaiHitungmundur(pembayaran.expiresAt);
  mulaiPolling(pembayaran.id);
}

function mulaiHitungmundur(expiresAt) {
  const akhir = new Date(expiresAt).getTime();
  stopHitungmundur();

  const tulis = () => {
    const sisa = Math.max(0, akhir - Date.now());
    const menit = Math.floor(sisa / 60_000);
    const detik = Math.floor((sisa % 60_000) / 1000);
    batasBayar.textContent = `${formatWaktu(expiresAt)} (${menit}:${String(detik).padStart(2, '0')} lagi)`;
  };

  tulis();
  timerHitung = setInterval(tulis, 1000);
}

function stopHitungmundur() {
  if (timerHitung) clearInterval(timerHitung);
  timerHitung = null;
}

function stopPolling() {
  if (timerPolling) clearTimeout(timerPolling);
  timerPolling = null;
}

/**
 * Polling status.
 *
 * Jeda dibuat_escalating supaya pembayaran yang sudah selesai tidak ditanya
 * server selamanya, dan server yang lambat tidak membuat antrean fetch menumpuk.
 */
function mulaiPolling(id) {
  stopPolling();
  let percobaan = 0;

  const poll = async () => {
    try {
      const pembayaran = await request(`/payments/${encodeURIComponent(id)}`);
      if (pembayaranAktif?.id !== id) return;

      if (pembayaran.status !== pembayaranAktif.status) {
        pembayaranAktif = pembayaran;
        setStatusBayar(pembayaran.status);
        barisTransaksi.hidden = !pembayaran.transactionId;
        idTransaksi.textContent = pembayaran.transactionId ?? '';
        tombolBatal.hidden = pembayaran.status !== 'pending';
        if (pembayaran.status !== 'pending') stopHitungmundur();
      }

      await refreshRiwayat();
      if (pembayaran.status !== 'pending') return;

      percobaan += 1;
      timerPolling = setTimeout(poll, Math.min(5000, 1000 * percobaan));
    } catch (error) {
      if (pembayaranAktif?.id !== id) return;
      percobaan += 1;
      if (percobaan > 5) {
        tampilkanGagal(`Tidak bisa menghubungi server: ${error.message}`);
        return;
      }
      timerPolling = setTimeout(poll, Math.min(5000, 1000 * percobaan));
    }
  };

  timerPolling = setTimeout(poll, 1000);
}

function tampilkanGagal(pesan) {
  stopPolling();
  stopHitungmundur();
  pesanGagal.textContent = pesan;
  tampilkan('gagal');
}

async function refreshRiwayat() {
  try {
    const pembayaran = await request('/payments');
    gambarRiwayat(pembayaran);
  } catch {
    // Riwayat bersifat tambahan. Kalau gagal, pembayaran yang sedang berjalan
    // tidak boleh ikut terganggu.
  }
}

function gambarRiwayat(pembayaran) {
  riwayatKosong.hidden = pembayaran.length > 0;
  daftarRiwayat.replaceChildren();

  for (const item of pembayaran.slice(0, 10)) {
    const li = document.createElement('li');

    const jumlah = document.createElement('span');
    jumlah.className = 'riwayat__jumlah';
    jumlah.textContent = `Rp ${formatRupiah(item.uniqueAmount)}`;

    const badge = document.createElement('span');
    badge.textContent = labelStatus(item.status);
    warnaiStatus(badge, item.status);

    const meta = document.createElement('span');
    meta.className = 'riwayat__meta';
    const parts = [formatWaktu(item.createdAt)];
    if (item.reference) parts.push(item.reference);
    meta.textContent = parts.join(' · ');

    li.append(jumlah, badge, meta);
    daftarRiwayat.append(li);
  }
}

formBuat.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusBuat.textContent = '';

  const amount = parseNominal(inputNominal.value);
  if (!Number.isInteger(amount) || amount <= 0) {
    errorNominal.textContent = 'Masukkan nominal angka lebih besar dari nol.';
    errorNominal.hidden = false;
    inputNominal.setAttribute('aria-invalid', 'true');
    inputNominal.focus();
    return;
  }

  errorNominal.hidden = true;
  inputNominal.removeAttribute('aria-invalid');
  tombolBuat.disabled = true;
  statusBuat.textContent = 'Membuat QRIS...';
  stopPolling();
  stopHitungmundur();
  tampilkan('muat');

  try {
    const pembayaran = await request('/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount,
        reference: inputRef.value.trim() || undefined,
      }),
    });

    nominalTerakhirDibuat = amount;
    inputNominal.value = '';
    inputRef.value = '';
    statusBuat.textContent = '';
    tampilkanHasil(pembayaran);
    await refreshRiwayat();
  } catch (error) {
    tombolBuat.disabled = false;
    statusBuat.textContent = '';
    tampilkanGagal(error.message);
  } finally {
    tombolBuat.disabled = false;
  }
});

tombolCoba.addEventListener('click', () => {
  if (nominalTerakhirDibuat === null) {
    tampilkan('kosong');
    return;
  }
  inputNominal.value = String(nominalTerakhirDibuat);
  inputNominal.focus();
  tampilkan('kosong');
});

tombolBatal.addEventListener('click', async () => {
  if (!pembayaranAktif) return;

  tombolBatal.disabled = true;
  statusAksi.textContent = 'Membatalkan...';
  try {
    await request(`/payments/${encodeURIComponent(pembayaranAktif.id)}/cancel`, { method: 'POST' });
    stopPolling();
    stopHitungmundur();
    pembayaranAktif = null;
    statusAksi.textContent = 'Pembayaran dibatalkan.';
    tampilkan('kosong');
    await refreshRiwayat();
  } catch (error) {
    statusAksi.textContent = error.message;
  } finally {
    tombolBatal.disabled = false;
  }
});

tampilkan('kosong');
refreshRiwayat();