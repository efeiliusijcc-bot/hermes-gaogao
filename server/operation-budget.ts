import { AsyncLocalStorage } from 'node:async_hooks';
import type { PgPool } from './auth-database.js';

export type OperationBudget = { signal: AbortSignal; deadlineAt: number };
const budgets = new AsyncLocalStorage<OperationBudget>();

export function withOperationBudget<T>(budget: OperationBudget, work: () => Promise<T>): Promise<T> {
  return budgets.run(budget, work);
}

export function checkOperationBudget(): void {
  const budget = budgets.getStore();
  if (!budget) return;
  budget.signal.throwIfAborted();
  if (Date.now() >= budget.deadlineAt) throw new Error('DRAFT_ANALYSIS_TIMEOUT');
}

export function operationRequestOptions() {
  checkOperationBudget();
  const budget = budgets.getStore();
  return budget ? { signal: budget.signal, timeout: Math.max(1, budget.deadlineAt - Date.now()) } : undefined;
}

// A scoped connection is destroyed on abort; shared service pools are never cancelled.
export function budgetedPool(pool: PgPool): PgPool {
  const budget = budgets.getStore();
  if (!budget) return pool;
  return {
    ...pool,
    connect: () => pool.connect(),
    end: () => pool.end(),
    query: async (sql, params) => {
      checkOperationBudget();
      const client = await pool.connect();
      let released = false;
      const abort = () => {
        if (!released) {
          released = true;
          (client.release as (destroy?: boolean) => void)(true);
        }
      };
      budget.signal.addEventListener('abort', abort, { once: true });
      try {
        checkOperationBudget();
        await client.query('BEGIN');
        await client.query("SELECT set_config('statement_timeout', $1, true)", [String(Math.max(1, budget.deadlineAt - Date.now()))]);
        const result = await client.query(sql, params);
        checkOperationBudget();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        if (!released) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        budget.signal.removeEventListener('abort', abort);
        if (!released) { released = true; client.release(); }
      }
    },
  };
}
