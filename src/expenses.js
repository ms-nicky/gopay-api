import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonExpenseStore {
  #path;
  #expenses = new Map();
  #writeChain = Promise.resolve();

  constructor(path = './.data/expenses.json') {
    this.#path = path;
    this.#load();
  }

  #load() {
    if (!existsSync(this.#path)) return;
    try {
      const records = JSON.parse(readFileSync(this.#path, 'utf8'));
      if (!Array.isArray(records)) throw new Error('Data pengeluaran harus berupa array.');
      for (const expense of records) {
        this.#expenses.set(expense.id, expense);
      }
    } catch (error) {
      throw new Error(`Gagal membaca data pengeluaran dari ${this.#path}: ${error.message}`);
    }
  }

  #persist() {
    this.#writeChain = this.#writeChain.then(() => {
      mkdirSync(dirname(this.#path), { recursive: true });
      const temporaryPath = `${this.#path}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify([...this.#expenses.values()], null, 2));
      renameSync(temporaryPath, this.#path);
    });
    return this.#writeChain;
  }

  async create({ amount, description, category = 'Operasional', date = new Date().toISOString() }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new TypeError('Nominal pengeluaran harus bilangan bulat positif.');
    }
    if (typeof description !== 'string' || !description.trim() || description.trim().length > 160) {
      throw new TypeError('Deskripsi wajib diisi dan maksimal 160 karakter.');
    }
    if (typeof category !== 'string' || !category.trim() || category.trim().length > 60) {
      throw new TypeError('Kategori wajib diisi dan maksimal 60 karakter.');
    }
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
      throw new TypeError('Tanggal pengeluaran tidak valid.');
    }

    const expense = {
      id: randomUUID(),
      amount,
      description: description.trim(),
      category: category.trim(),
      createdAt: new Date(date).toISOString(),
    };
    this.#expenses.set(expense.id, expense);
    await this.#persist();
    return expense;
  }

  async delete(id) {
    if (!this.#expenses.has(id)) return false;
    this.#expenses.delete(id);
    await this.#persist();
    return true;
  }

  all() {
    return [...this.#expenses.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}
