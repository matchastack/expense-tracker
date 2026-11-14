'use client';

import { useEffect, useState } from 'react';
import {
  buildIndex,
  computeBalances,
  computeNetWorth,
  computePlan,
  fixList,
  monthIndex,
  nameSuggestions,
  owedToMe,
  type Balance,
  type Dataset,
  type ExpenseInfo,
  type FixItem,
  type IncomeInfo,
  type Index,
  type NetWorth,
  type Plan,
  type Suggestion,
} from './finance';
import { SETTING, type Recurring, type Tables, type Todo } from './schema';
import { useStore } from './store';

export interface Derived {
  data: Dataset;
  todos: Todo[];
  recurring: Recurring[];
  ix: Index;
  /** Newest first. */
  expenses: ExpenseInfo[];
  incomes: IncomeInfo[];
  balances: Map<string, Balance>;
  netWorth: NetWorth;
  currency: string;
  savingsTarget: number;
  fixSince: string | null;
  /** The current month. */
  month: number;
  plan: Plan;
  fixes: FixItem[];
  owed: ExpenseInfo[];
  suggestions: Suggestion[];
  now: Date;
}

export function setting<T>(tables: Tables, key: string, fallback: T): T {
  const row = tables.settings[key];
  return row && row.value !== null && row.value !== undefined ? (row.value as T) : fallback;
}

export function derive(tables: Tables, now: Date): Derived {
  const data: Dataset = {
    assetCategories: Object.values(tables.assetCategories),
    accounts: Object.values(tables.accounts),
    paymentMethods: Object.values(tables.paymentMethods),
    expenseCategories: Object.values(tables.expenseCategories),
    incomeCategories: Object.values(tables.incomeCategories),
    expenses: Object.values(tables.expenses),
    incomes: Object.values(tables.incomes),
  };
  const ix = buildIndex(data, now);
  const balances = computeBalances(ix);
  const savingsTarget = Number(setting(tables, SETTING.savingsTarget, 0)) || 0;
  const fixSince = setting<string | null>(tables, SETTING.fixSince, null);
  const month = monthIndex(now);
  return {
    data,
    todos: Object.values(tables.todos),
    recurring: Object.values(tables.recurring),
    ix,
    expenses: [...ix.expenses].sort((a, b) => b.time - a.time),
    incomes: [...ix.incomes].sort((a, b) => b.time - a.time),
    balances,
    netWorth: computeNetWorth(ix, balances),
    currency: String(setting(tables, SETTING.currency, '$')),
    savingsTarget,
    fixSince,
    month,
    plan: computePlan(ix, month, savingsTarget),
    fixes: fixList(ix, fixSince),
    owed: owedToMe(ix),
    suggestions: nameSuggestions(data.expenses),
    now,
  };
}

let memo: { tables: Tables; minute: number; value: Derived } | null = null;

/** Everything the screens need, recomputed only when the data (or the minute) changes. */
export function useDerived(): Derived {
  const { tables } = useStore();
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const tick = () => setMinute(Math.floor(Date.now() / 60_000));
    const id = setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  if (!memo || memo.tables !== tables || memo.minute !== minute) {
    memo = { tables, minute, value: derive(tables, new Date()) };
  }
  return memo.value;
}
