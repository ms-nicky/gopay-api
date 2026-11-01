const $ = (id) => document.getElementById(id);
const formatRp = (amount) => `Rp ${new Intl.NumberFormat('id-ID').format(amount)}`;
const savedKey = () => {
  try {
    return sessionStorage.getItem('flowpay-api-key') ?? '';
  } catch {
    return '';
  }
};

let payments = [];
let expenses = [];
let qrObjectUrl;

function setTheme(theme) {
  document.body.dataset.theme = theme;
  try {
    localStorage.setItem('flowpay-theme', theme);
  } catch {}
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const isDark = theme === 'dark';
    button.querySelector('.theme-toggle__icon').textContent = isDark ? '☀️' : '🌙';
    button.querySelector('.theme-toggle__label').textContent = isDark ? 'Cerah' : 'Gelap';
    button.setAttribute('aria-label', isDark ? 'Ubah tema ke cerah' : 'Ubah tema ke gelap');
  });
}

try {
  setTheme(localStorage.getItem('flowpay-theme') || 'light');
} catch {
  setTheme('light');
}

document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  });
});

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  const key = savedKey();
  if (key) headers.set('x-api-key', key);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.message ?? (response.status === 401
      ? 'API key ditolak. Masukkan API key yang benar.'
      : `Permintaan gagal (${response.status}).`);
    throw new Error(message);
  }
  return result;
}

function setError(message = '') {
  const error = $('dashboard-error');
  error.textContent = message;
  error.hidden = !message;
}

function setConnection(message, connected = false) {
  const status = $('connection-status');
  status.textContent = message;
  status.classList.toggle('is-connected', connected);
}

function statusText(status) {
  return {
    paid: 'Lunas',
    pending: 'Menunggu',
    expired: 'Kedaluwarsa',
    cancelled: 'Dibatalkan',
  }[status] ?? status;
}

function statusClass(status) {
  return status === 'paid' ? 'pill--success'
    : status === 'pending' ? 'pill--pending'
      : 'pill--danger';
}

function dateLabel(date) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(date));
}

function drawTransactions() {
  const body = $('transactions-body');
  body.replaceChildren();
  if (!payments.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-empty">Belum ada transaksi.</td></tr>';
    return;
  }

  for (const payment of payments.slice(0, 20)) {
    const row = document.createElement('tr');
    const reference = document.createElement('td');
    reference.className = 'col-customer';
    reference.textContent = payment.reference || payment.id.slice(0, 12);
    const date = document.createElement('td');
    date.textContent = dateLabel(payment.settledAt || payment.createdAt);
    const amount = document.createElement('td');
    amount.textContent = formatRp(payment.uniqueAmount);
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `pill ${statusClass(payment.status)}`;
    badge.textContent = statusText(payment.status);
    status.append(badge);
    const actions = document.createElement('td');
    if (payment.status === 'pending') {
      const cancel = document.createElement('button');
      cancel.className = 'table-action';
      cancel.type = 'button';
      cancel.textContent = 'Batalkan';
      cancel.addEventListener('click', () => cancelPayment(payment.id, cancel));
      actions.append(cancel);
    } else {
      actions.textContent = '—';
    }
    row.append(reference, date, amount, status, actions);
    body.append(row);
  }
}

async function cancelPayment(id, button) {
  button.disabled = true;
  try {
    await api(`/payments/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    await refreshDashboard();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

function drawExpenses() {
  const list = $('expense-list');
  list.replaceChildren();
  if (!expenses.length) {
    const empty = document.createElement('p');
    empty.className = 'table-empty';
    empty.textContent = 'Belum ada pengeluaran.';
    list.append(empty);
    return;
  }

  for (const expense of expenses.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    const detail = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = expense.description;
    const meta = document.createElement('span');
    meta.textContent = `${expense.category} · ${dateLabel(expense.createdAt)}`;
    detail.append(title, meta);
    const amount = document.createElement('strong');
    amount.className = 'expense-row__amount';
    amount.textContent = `− ${formatRp(expense.amount)}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'table-action table-action--danger';
    remove.textContent = 'Hapus';
    remove.setAttribute('aria-label', `Hapus pengeluaran ${expense.description}`);
    remove.addEventListener('click', () => deleteExpense(expense.id, remove));
    row.append(detail, amount, remove);
    list.append(row);
  }
}

async function deleteExpense(id, button) {
  button.disabled = true;
  try {
    await api(`/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshDashboard();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

function drawSummary() {
  const paid = payments.filter((payment) => payment.status === 'paid');
  const pending = payments.filter((payment) => payment.status === 'pending');
  const failed = payments.filter((payment) => ['expired', 'cancelled'].includes(payment.status));
  const income = paid.reduce((sum, payment) => sum + payment.uniqueAmount, 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalTransactions = Math.max(1, paid.length + pending.length + failed.length);

  $('total-income').textContent = formatRp(income);
  $('total-expense').textContent = formatRp(expenseTotal);
  $('net-balance').textContent = formatRp(income - expenseTotal);
  $('pending-count').textContent = new Intl.NumberFormat('id-ID').format(pending.length);
  $('paid-count').textContent = paid.length;
  $('pending-summary').textContent = pending.length;
  $('failed-count').textContent = failed.length;
  $('paid-progress').style.width = `${(paid.length / totalTransactions) * 100}%`;
  $('pending-progress').style.width = `${(pending.length / totalTransactions) * 100}%`;
  $('failed-progress').style.width = `${(failed.length / totalTransactions) * 100}%`;
}

function drawChart() {
  const chart = $('cashflow-chart');
  chart.replaceChildren();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return date;
  });
  const buckets = days.map((date) => ({
    date,
    income: 0,
    expense: 0,
  }));
  const dayKey = (date) => {
    const parsed = new Date(date);
    return `${parsed.getFullYear()}-${parsed.getMonth()}-${parsed.getDate()}`;
  };
  const keys = new Map(buckets.map((bucket, index) => [dayKey(bucket.date), index]));

  for (const payment of payments) {
    if (payment.status !== 'paid') continue;
    const index = keys.get(dayKey(payment.settledAt || payment.createdAt));
    if (index !== undefined) buckets[index].income += payment.uniqueAmount;
  }
  for (const expense of expenses) {
    const index = keys.get(dayKey(expense.createdAt));
    if (index !== undefined) buckets[index].expense += expense.amount;
  }

  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.income, bucket.expense]));
  for (const bucket of buckets) {
    const column = document.createElement('div');
    column.className = 'cashflow-day';
    const bars = document.createElement('div');
    bars.className = 'cashflow-day__bars';
    for (const [kind, value] of [['income', bucket.income], ['expense', bucket.expense]]) {
      const bar = document.createElement('span');
      bar.className = `cashflow-bar cashflow-bar--${kind}`;
      bar.style.height = `${value ? Math.max(5, (value / max) * 100) : 2}%`;
      bar.title = `${kind === 'income' ? 'Pemasukan' : 'Pengeluaran'}: ${formatRp(value)}`;
      bars.append(bar);
    }
    const label = document.createElement('span');
    label.className = 'cashflow-day__label';
    label.textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(bucket.date);
    column.append(bars, label);
    chart.append(column);
  }
}

function downloadCsv() {
  const records = [
    ['Jenis', 'Tanggal', 'Keterangan', 'Kategori', 'Nominal', 'Status'],
    ...payments.map((payment) => [
      'Pemasukan',
      payment.settledAt || payment.createdAt,
      payment.reference || payment.id,
      'Pembayaran QRIS',
      payment.uniqueAmount,
      statusText(payment.status),
    ]),
    ...expenses.map((expense) => [
      'Pengeluaran',
      expense.createdAt,
      expense.description,
      expense.category,
      -expense.amount,
      'Tercatat',
    ]),
  ];
  const csv = records
    .map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `flowpay-laporan-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshDashboard() {
  setError();
  try {
    [payments, expenses] = await Promise.all([api('/payments'), api('/expenses')]);
    drawSummary();
    drawChart();
    drawTransactions();
    drawExpenses();
    setConnection(`Terhubung · ${payments.length} transaksi · diperbarui ${new Date().toLocaleTimeString('id-ID')}`, true);
  } catch (error) {
    setConnection('Belum terhubung. Periksa API key atau koneksi server.');
    setError(error.message);
  }
}

$('api-key-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const key = $('api-key-input').value.trim();
  try {
    if (key) sessionStorage.setItem('flowpay-api-key', key);
    else sessionStorage.removeItem('flowpay-api-key');
  } catch {
    setError('Browser tidak mengizinkan penyimpanan API key untuk sesi ini.');
    return;
  }
  $('api-key-input').value = '';
  refreshDashboard();
});

$('expense-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('expense-status');
  const button = $('save-expense');
  const amount = Number.parseInt($('expense-amount').value.replace(/\D/g, ''), 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    status.textContent = 'Masukkan nominal pengeluaran yang valid.';
    return;
  }

  button.disabled = true;
  status.textContent = 'Menyimpan pengeluaran...';
  try {
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        description: $('expense-description').value.trim(),
        category: $('expense-category').value.trim(),
      }),
    });
    $('expense-form').reset();
    $('expense-category').value = 'Operasional';
    status.textContent = 'Pengeluaran berhasil dicatat.';
    await refreshDashboard();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('dashboard-payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('create-payment');
  const status = $('payment-status');
  const amount = Number.parseInt($('payment-amount').value.replace(/\D/g, ''), 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    status.textContent = 'Masukkan nominal pembayaran yang valid.';
    return;
  }

  button.disabled = true;
  status.textContent = 'Membuat pembayaran...';
  $('dashboard-qr-result').hidden = true;
  try {
    const payment = await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        reference: $('payment-reference').value.trim() || undefined,
      }),
    });
    const key = savedKey();
    const response = await fetch(`/payments/${encodeURIComponent(payment.id)}/qr.png`, {
      headers: key ? { 'x-api-key': key } : {},
    });
    if (!response.ok) throw new Error(`QRIS tidak dapat dimuat (${response.status}).`);
    if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = URL.createObjectURL(await response.blob());
    $('dashboard-qr').src = qrObjectUrl;
    $('dashboard-qr-amount').textContent = formatRp(payment.uniqueAmount);
    $('dashboard-qr-reference').textContent = payment.reference || payment.id;
    $('dashboard-qr-result').hidden = false;
    $('payment-amount').value = '';
    $('payment-reference').value = '';
    status.textContent = 'QRIS berhasil dibuat. Minta pelanggan memindai kode ini.';
    await refreshDashboard();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('export-csv').addEventListener('click', downloadCsv);
$('api-key-input').value = savedKey();
refreshDashboard();
window.setInterval(refreshDashboard, 15_000);
window.addEventListener('beforeunload', () => {
  if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
});
