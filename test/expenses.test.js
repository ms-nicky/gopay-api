import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonExpenseStore } from '../src/expenses.js';

test('pengeluaran bertahan setelah store dibuat ulang', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gopay-expenses-'));
  const path = join(dir, 'expenses.json');
  try {
    const first = new JsonExpenseStore(path);
    const created = await first.create({
      amount: 25_000,
      description: 'Internet kantor',
      category: 'Operasional',
    });

    const second = new JsonExpenseStore(path);
    assert.deepEqual(second.all(), [created]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

