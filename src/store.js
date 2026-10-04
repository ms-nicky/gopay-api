import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Payment store berbasis file JSON.
 *
 * `merchantid` hanya menyediakan InMemoryPaymentStore, yang hilang setiap
 * restart. Akibatnya nominal unik yang pernah dialokasikan bisa dipakai ulang
 * order lama, sehingga satu transfer bisa melunasi dua pesanan. Store persisten
 * menutup celah itu.
 *
 * Penulisan lewat write-tempfile lalu rename supaya file tidak pernah tertinggal
 * separuh tertulis bila proses mati di tengah operasi. Penulisan juga
 * diantrikan lewat #writeChain supaya dua update bersamaan tidak saling
 * menimpa dengan snapshot yang sama.
 */
export class JsonPaymentStore {
  #path;
  #payments = new Map();
  #writeChain = Promise.resolve();

  constructor(path = './.data/payments.json') {
    this.#path = path;
    this.#load();
  }

  #load() {
    if (!existsSync(this.#path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.#path, 'utf8'));
      for (const payment of parsed) {
        this.#payments.set(payment.id, payment);
      }
    } catch {
      // File rusak tidak boleh menghentikan gateway. Pembayaran yang hilang
      // akan kedaluwarsa sendiri karena tidak ada yang bisa mencocokkannya.
    }
  }

  #persist() {
    this.#writeChain = this.#writeChain.then(() => {
      mkdirSync(dirname(this.#path), { recursive: true });
      const snapshot = JSON.stringify([...this.#payments.values()], null, 2);
      const tmp = `${this.#path}.tmp`;
      writeFileSync(tmp, snapshot);
      renameSync(tmp, this.#path);
    });
    return this.#writeChain;
  }

  #sameScope(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return left.providerId === right.providerId && left.merchantId === right.merchantId;
  }

  create(payment) {
    this.#payments.set(payment.id, payment);
    return this.#persist();
  }

  update(payment) {
    this.#payments.set(payment.id, payment);
    return this.#persist();
  }

  get(id) {
    return this.#payments.get(id);
  }

  /**
   * Hanya `pending` yang masih memegang slot nominal. `paid` sudah lunas dan
   * nominalnya bebas dipakai ulang order berikutnya.
   */
  listActive(scope) {
    const active = [];
    for (const payment of this.#payments.values()) {
      if (payment.status !== 'pending') continue;
      if (scope && !this.#sameScope(payment.scope, scope)) continue;
      active.push(payment);
    }
    return active;
  }

  /** Seluruh pembayaran tanpa filter status, untuk keperluan debugging. */
  all() {
    return [...this.#payments.values()];
  }
}