#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { GopayProvider } from 'merchantid';
import { config } from '../src/config.js';
import { SessionStore } from '../src/session.js';

/**
 * CLI untuk login GoPay Merchant dan mengelola merchant.
 *
 * Perintah:
 *   login              login OTP dan simpan session
 *   merchants          daftar merchant yang bisa diakses akun ini
 *   whoami             tampilkan session yang tersimpan
 *   logout             hapus session tersimpan
 */
const command = process.argv[2];
const sessionStore = new SessionStore(config.sessionFile, config.sessionPassphrase);

switch (command) {
  case 'login':
    await login();
    break;
  case 'merchants':
    await listMerchants();
    break;
  case 'whoami':
    await whoami();
    break;
  case 'logout':
    sessionStore.clear();
    console.log('Session dihapus.');
    break;
  default:
    console.log('Perintah: login | merchants | whoami | logout');
    process.exit(1);
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}

function buildProvider(session) {
  return new GopayProvider({
    merchantId: config.merchantId,
    session,
    staticQris: config.staticQris,
    onTokenRefreshed: async (refreshed) => sessionStore.save(refreshed),
  });
}

async function login() {
  const entered = await prompt('Nomor HP merchant (format 62...): ');
  const phone = (entered.trim() || config.merchantPhone || '').replace(/^\+/, '');
  if (!phone) {
    console.error('Nomor HP wajib diisi, atau set MERCHANT_PHONE di .env.');
    process.exit(1);
  }

  const provider = buildProvider(undefined);

  console.log(`Mengirim OTP ke ${phone}...`);
  const challenge = await provider.requestOtp(phone);

  const otp = await prompt('Masukkan OTP: ');
  await provider.verifyOtp({
    otp: otp.trim(),
    otpToken: challenge.otpToken,
    phoneNumber: phone,
  });

  sessionStore.save(provider.exportSession());
  console.log('Login berhasil. Session tersimpan di', config.sessionFile);

  const merchants = await provider.listMerchants();
  if (merchants.length > 0) {
    console.log('\nMerchant yang bisa diakses:');
    for (const merchant of merchants) {
      console.log(`  ${merchant.id}  ${merchant.merchantName} / ${merchant.outletName ?? '-'}`);
    }
  }
}

async function listMerchants() {
  const session = sessionStore.load();
  if (!session) {
    console.error('Belum login. Jalankan `npm run login` dulu.');
    process.exit(1);
  }

  const provider = buildProvider(session);
  const merchants = await provider.listMerchants();

  if (merchants.length === 0) {
    console.log('Tidak ada merchant yang bisa diakses.');
    return;
  }

  console.log('Merchant:');
  for (const merchant of merchants) {
    console.log(`\n  id       : ${merchant.id}`);
    console.log(`  merchant : ${merchant.merchantName}`);
    console.log(`  outlet   : ${merchant.outletName ?? '-'}`);
    console.log(`  qris     : ${merchant.qrString ? merchant.qrString.slice(0, 40) + '...' : 'tidak ada'}`);
  }
}

async function whoami() {
  const session = sessionStore.load();
  if (!session) {
    console.log('Belum ada session tersimpan.');
    return;
  }

  const provider = buildProvider(session);
  console.log(`Merchant id : ${config.merchantId ?? 'belum diset'}`);

  if (!provider.authenticated) {
    console.log('Session tidak terautentikasi. Jalankan `npm run login`.');
    return;
  }

  const profile = await provider.getMerchantProfile();
  console.log(`Merchant    : ${profile.merchantName}`);
  console.log(`Outlet      : ${profile.outletName ?? '-'}`);
  console.log(`Outlets     : ${profile.outlets?.length ?? 0}`);

  const resolved = await provider.resolveStaticQris();
  if (resolved) {
    console.log('\nSalin ke .env sebagai STATIC_QRIS:');
    console.log(resolved);
  }
}