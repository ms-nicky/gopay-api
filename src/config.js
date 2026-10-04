import { readFileSync, existsSync } from 'node:fs';

function parseEnvFile(path = '.env') {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile();

function read(name, fallback = undefined) {
  const value = process.env[name] ?? fileEnv[name];
  return value === undefined || value === '' ? fallback : value;
}

function readInt(name, fallback) {
  const value = read(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const config = {
  merchantPhone: read('MERCHANT_PHONE'),
  merchantId: read('MERCHANT_ID'),
  staticQris: read('STATIC_QRIS'),
  sessionFile: read('SESSION_FILE', './.data/session.json'),
  sessionPassphrase: read('SESSION_PASSPHRASE'),
  apiKey: read('API_KEY'),
  webhookUrl: read('WEBHOOK_URL'),
  webhookSecret: read('WEBHOOK_SECRET'),
  port: readInt('PORT', 3000),
  pollIntervalMs: readInt('POLL_INTERVAL_MS', 5000),
  defaultExpiryMs: readInt('DEFAULT_EXPIRY_MS', 300000),
  clockSkewMs: readInt('CLOCK_SKEW_MS', 60000),
  maxUniqueOffset: readInt('MAX_UNIQUE_OFFSET', 999),
};

export function requireConfig(...keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Konfigurasi belum lengkap: ${missing.join(', ')}. Salin .env.example ke .env lalu isi.`,
    );
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}