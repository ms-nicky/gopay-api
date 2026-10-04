import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function deriveKey(passphrase) {
  return createHash('sha256').update(passphrase).digest();
}

/**
 * Penyimpanan session merchant.
 *
 * Session berisi access token + refresh token GoPay Merchant, jadi nilainya
 * setara password akun. Dua lapis proteksi:
 *
 * 1. Dipisah dari source code, disimpan di luar repo (`SESSION_FILE`).
 * 2. Enkripsi AES-256-GCM bila `SESSION_PASSPHRASE` diset, sehingga file yang
 *    bocor tidak langsung memberi akses ke akun.
 *
 * Tanpa passphrase, file tetap ditulis dengan permission 0600.
 */
export class SessionStore {
  #path;
  #passphrase;

  constructor(path, passphrase) {
    this.#path = path;
    this.#passphrase = passphrase || null;
  }

  exists() {
    return existsSync(this.#path);
  }

  save(session) {
    const body = JSON.stringify(session);
    const payload = this.#passphrase
      ? { encrypted: true, ...this.#encrypt(body) }
      : { encrypted: false, session: JSON.parse(body) };

    mkdirSync(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    renameSync(tmp, this.#path);
    try {
      // rename mempertahankan mode file asal, jadi pastikan eksplisit di akhir.
      chmodSync(this.#path, 0o600);
    } catch {
      // Tidak semua filesystem mendukung chmod; abaikan.
    }
  }

  load() {
    if (!existsSync(this.#path)) return null;
    let payload;
    try {
      payload = JSON.parse(readFileSync(this.#path, 'utf8'));
    } catch {
      throw new Error(`File session rusak: ${this.#path}`);
    }
    if (payload.encrypted) {
      return JSON.parse(this.#decrypt(payload));
    }
    return payload.session;
  }

  clear() {
    if (existsSync(this.#path)) {
      rmSync(this.#path);
    }
  }

  #encrypt(plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, deriveKey(this.#passphrase), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: enc.toString('base64'),
    };
  }

  #decrypt({ iv, tag, data }) {
    const decipher = createDecipheriv(ALGO, deriveKey(this.#passphrase), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  }
}