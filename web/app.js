const el = (id) => document.getElementById(id);

const themeToggleButtons = document.querySelectorAll('[data-theme-toggle]');
const applyTheme = (theme) => {
  document.body.dataset.theme = theme;
  try {
    localStorage.setItem('flowpay-theme', theme);
  } catch {}

  themeToggleButtons.forEach((button) => {
    const icon = button.querySelector('.theme-toggle__icon');
    const label = button.querySelector('.theme-toggle__label');
    const isDark = theme === 'dark';
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
    if (label) label.textContent = isDark ? 'Cerah' : 'Gelap';
    button.setAttribute('aria-label', isDark ? 'Ubah tema ke cerah' : 'Ubah tema ke gelap');
  });
};

const savedTheme = (() => {
  try {
    return localStorage.getItem('flowpay-theme') || 'light';
  } catch {
    return 'light';
  }
})();
applyTheme(savedTheme);

themeToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const current = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(current);
  });
});

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

function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID').format(angka);
}

function parseNominal(nilai) {
  const digit = nilai.replace(/\D/g, '');
  if (!digit) return NaN;
  return Number.parseInt(digit, 10);
}

const LABEL_STATUS = {
  pending: 'menunggu',
  paid: 'lunas',
  expired: 'kedaluwarsa',
  cancelled: 'dibatalkan',
};

const labelStatus = (status) => LABEL_STATUS[status] ?? status;

function warnaiStatus(el, status) {
  if (!el) return;
  el.className = 'status';
  if (status === 'paid') el.classList.add('status--lunas');
  if (status === 'expired' || status === 'cancelled') el.classList.add('status--gagal');
}

function setStatusBayar(status) {
  if (!statusBayar) return;
  statusBayar.textContent = labelStatus(status);
  warnaiStatus(statusBayar, status);
}

function formatWaktu(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

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
  const headers = new Headers(options?.headers);
  try {
    const key = sessionStorage.getItem('flowpay-api-key');
    if (key) headers.set('x-api-key', key);
  } catch {}
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message ?? LABEL_ERROR[body.error] ?? `Permintaan gagal (${response.status}).`);
  }
  return body;
}

function tampilkan(state) {
  if (!panelKosong || !panelMuat || !panelGagal || !panelHasil) return;
  panelKosong.hidden = state !== 'kosong';
  panelMuat.hidden = state !== 'muat';
  panelGagal.hidden = state !== 'gagal';
  panelHasil.hidden = state !== 'hasil';
}

function tampilkanHasil(pembayaran) {
  pembayaranAktif = pembayaran;

  if (nominalBayar) nominalBayar.textContent = `Rp ${formatRupiah(pembayaran.uniqueAmount)}`;

  const selisih = pembayaran.uniqueAmount - pembayaran.baseAmount;
  if (nominalAsli) {
    nominalAsli.textContent =
      selisih === 0
        ? 'Tidak ada selisih.'
        : `Pesan Rp ${formatRupiah(pembayaran.baseAmount)}, pembayaran persis Rp ${formatRupiah(pembayaran.uniqueAmount)} agar tidak tertukar dengan order lain.`;
  }

  setStatusBayar(pembayaran.status);
  if (barisTransaksi) barisTransaksi.hidden = !pembayaran.transactionId;
  if (idTransaksi) idTransaksi.textContent = pembayaran.transactionId ?? '';
  if (gambarQris) {
    gambarQris.src = `/payments/${encodeURIComponent(pembayaran.id)}/qr.png`;
    gambarQris.alt = `QRIS untuk pembayaran Rp ${formatRupiah(pembayaran.uniqueAmount)}`;
  }

  tampilkan('hasil');
  if (tombolBatal) tombolBatal.hidden = pembayaran.status !== 'pending';

  mulaiHitungmundur(pembayaran.expiresAt);
  mulaiPolling(pembayaran.id);
}

function mulaiHitungmundur(expiresAt) {
  if (!batasBayar) return;
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
        if (barisTransaksi) barisTransaksi.hidden = !pembayaran.transactionId;
        if (idTransaksi) idTransaksi.textContent = pembayaran.transactionId ?? '';
        if (tombolBatal) tombolBatal.hidden = pembayaran.status !== 'pending';
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
  if (!pesanGagal) return;
  stopPolling();
  stopHitungmundur();
  pesanGagal.textContent = pesan;
  tampilkan('gagal');
}

async function refreshRiwayat() {
  if (!daftarRiwayat || !riwayatKosong) return;
  try {
    const pembayaran = await request('/payments');
    gambarRiwayat(pembayaran);
  } catch {
    // Riwayat bersifat tambahan.
  }
}

function gambarRiwayat(pembayaran) {
  if (!daftarRiwayat || !riwayatKosong) return;
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

if (formBuat && inputNominal && inputRef && errorNominal && tombolBuat && statusBuat) {
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

  if (tombolCoba) {
    tombolCoba.addEventListener('click', () => {
      if (nominalTerakhirDibuat === null) {
        tampilkan('kosong');
        return;
      }
      inputNominal.value = String(nominalTerakhirDibuat);
      inputNominal.focus();
      tampilkan('kosong');
    });
  }

  if (tombolBatal) {
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
  }

  tampilkan('kosong');
  refreshRiwayat();
}
