import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  computeBalances,
  computeCheckup,
  computeNetWorth,
  computePlan,
  costInMonth,
  dueRecurring,
  expenseIssues,
  fixList,
  incomeIssues,
  matchSuggestions,
  monthIndex,
  nameSuggestions,
  owedToMe,
  parseAmount,
  type Dataset,
} from '@/lib/finance';
import type { Expense, Income, Recurring } from '@/lib/schema';

const NOW = new Date('2026-11-14T12:00:00+08:00');
const NOV = monthIndex(NOW);

let seq = 0;
const expense = (over: Partial<Expense>): Expense => ({
  id: `e${++seq}`,
  name: 'x',
  amount: 10,
  date: '2026-11-10T12:00:00+08:00',
  categoryId: 'food',
  paymentMethodId: 'pm-bank',
  targetAccountId: null,
  myShare: null,
  splitWith: '',
  spreadMonths: null,
  exclude: false,
  createdAt: '2026-11-10T12:00:00+08:00',
  source: 'app',
  ...over,
});
const income = (over: Partial<Income>): Income => ({
  id: `i${++seq}`,
  name: 'y',
  amount: 100,
  date: '2026-11-05T12:00:00+08:00',
  categoryId: 'salary',
  paymentMethodId: 'pm-bank',
  sourceAccountId: null,
  expenseId: null,
  exclude: false,
  createdAt: '2026-11-05T12:00:00+08:00',
  source: 'app',
  ...over,
});

const base = (expenses: Expense[] = [], incomes: Income[] = []): Dataset => ({
  assetCategories: [
    { id: 'liquid', name: 'Liquid Asset', type: 'asset', kind: 'liquid' },
    { id: 'invest', name: 'Investment Asset', type: 'asset', kind: 'investment' },
    { id: 'short', name: 'Short Term Liability', type: 'liability', kind: 'short' },
  ],
  accounts: [
    { id: 'bank', name: 'Bank', type: 'asset', categoryId: 'liquid', initialValue: 1000, purchasedDate: null, inNetWorth: true, archived: false },
    { id: 'broker', name: 'Broker', type: 'asset', categoryId: 'invest', initialValue: 5000, purchasedDate: null, inNetWorth: true, archived: false },
    { id: 'card', name: 'Card', type: 'liability', categoryId: 'short', initialValue: 0, purchasedDate: null, inNetWorth: true, archived: false },
  ],
  paymentMethods: [
    { id: 'pm-bank', name: 'Bank', type: 'bank', accountId: 'bank', archived: false },
    { id: 'pm-paynow', name: 'PayNow', type: 'ewallet', accountId: 'bank', archived: false },
    { id: 'pm-card', name: 'Visa', type: 'card', accountId: 'card', archived: false },
  ],
  expenseCategories: [
    { id: 'food', name: '0 | Food & Drinks', budgetLimit: 350, archived: false },
    { id: 'travel', name: '10 | Travel', budgetLimit: 150, archived: false },
    { id: 'invest-x', name: '7 | Investment', budgetLimit: 1000, archived: false },
  ],
  incomeCategories: [
    { id: 'salary', name: '1 | Salary', type: 'income', target: 6000, archived: false },
    { id: 'transfer', name: '5 | Transfer', type: 'transfer', target: 0, archived: false },
    { id: 'cardpay', name: '6 | Credit Card Payment', type: 'card_payment', target: 0, archived: false },
    { id: 'refund', name: '7 | Reimbursement & Refund', type: 'reimbursement', target: 0, archived: false },
  ],
  expenses,
  incomes,
});

describe('my cost, split bills and refunds', () => {
  it('uses the amount when the bill is all mine', () => {
    const ix = buildIndex(base([expense({ id: 'a', amount: 42.5 })]), NOW);
    expect(ix.expenseById.get('a')).toMatchObject({ myCost: 42.5, theirShare: 0, owed: 0, repaid: 0 });
  });

  it("is 0 for Don't Include rows", () => {
    const ix = buildIndex(base([expense({ id: 'a', amount: 42.5, exclude: true })]), NOW);
    expect(ix.expenseById.get('a')!.myCost).toBe(0);
  });

  it('counts only my share of a split bill and tracks what is owed', () => {
    const data = base(
      [expense({ id: 'dinner', amount: 100, myShare: 40 })],
      [income({ categoryId: 'refund', expenseId: 'dinner', amount: 25 })],
    );
    const info = buildIndex(data, NOW).expenseById.get('dinner')!;
    expect(info).toMatchObject({ myCost: 40, theirShare: 60, repaid: 25, owed: 35 });
  });

  it('treats My Share = 0 as all for others', () => {
    const info = buildIndex(base([expense({ id: 'a', amount: 80, myShare: 0 })]), NOW).expenseById.get('a')!;
    expect(info).toMatchObject({ myCost: 0, theirShare: 80, owed: 80 });
  });

  it('a full repayment settles the bill without changing my cost', () => {
    const data = base(
      [expense({ id: 'dinner', amount: 100, myShare: 40 })],
      [
        income({ categoryId: 'refund', expenseId: 'dinner', amount: 30 }),
        income({ categoryId: 'refund', expenseId: 'dinner', amount: 30 }),
      ],
    );
    expect(buildIndex(data, NOW).expenseById.get('dinner')).toMatchObject({ myCost: 40, owed: 0, repaid: 60 });
  });

  it('a merchant refund lowers the cost of the purchase', () => {
    const data = base(
      [expense({ id: 'shoes', amount: 120 })],
      [income({ categoryId: 'refund', expenseId: 'shoes', amount: 120, date: '2026-12-02T10:00:00+08:00' })],
    );
    const ix = buildIndex(data, new Date('2026-12-10T10:00:00+08:00'));
    expect(ix.expenseById.get('shoes')!.myCost).toBe(0);
    // ...in the purchase's month, even though the refund arrived later.
    expect(computePlan(ix, NOV, 0).spent).toBe(0);
  });

  it('lists split bills by what is still owed', () => {
    const data = base([
      expense({ id: 'a', amount: 50, myShare: 20 }),
      expense({ id: 'b', amount: 90, myShare: 10 }),
      expense({ id: 'c', amount: 10 }),
    ]);
    expect(owedToMe(buildIndex(data, NOW)).map((e) => e.expense.id)).toEqual(['b', 'a']);
  });
});

describe('spread costs', () => {
  const yearly = expense({ id: 'ins', amount: 1200, spreadMonths: 12, date: '2026-09-20T09:00:00+08:00' });
  const ix = buildIndex(base([yearly]), NOW);
  const info = ix.expenseById.get('ins')!;
  const SEP = NOV - 2;

  it('counts 1/N per month for N months starting in the purchase month', () => {
    expect(costInMonth(info, SEP - 1, ix.now)).toBe(0);
    expect(costInMonth(info, SEP, ix.now)).toBe(100);
    expect(costInMonth(info, NOV, ix.now)).toBe(100);
    expect(costInMonth(info, SEP + 11, ix.now)).toBe(100);
    expect(costInMonth(info, SEP + 12, ix.now)).toBe(0);
  });

  it('feeds the monthly plan', () => {
    expect(computePlan(ix, NOV, 0).spent).toBe(100);
  });

  it('spreads my share, not the full amount', () => {
    const split = expense({ id: 's', amount: 600, myShare: 300, spreadMonths: 3 });
    const i2 = buildIndex(base([split]), NOW);
    expect(costInMonth(i2.expenseById.get('s')!, NOV, i2.now)).toBe(100);
  });
});

describe('monthly plan', () => {
  const data = base(
    [
      expense({ amount: 12.3 }),
      expense({ amount: 7.7 }),
      expense({ amount: 60, categoryId: 'travel' }),
      expense({ amount: 2000, categoryId: 'invest-x', exclude: true, targetAccountId: 'broker' }),
      expense({ amount: 15, categoryId: null }),
      expense({ amount: 99, date: '2026-10-28T12:00:00+08:00' }),
      expense({ amount: 500, date: '2026-11-20T12:00:00+08:00' }), // future-dated
    ],
    [
      income({ amount: 5200 }),
      income({ amount: 200, categoryId: 'transfer', sourceAccountId: 'broker' }),
      income({ amount: 250.5, categoryId: 'cardpay', paymentMethodId: 'pm-card', sourceAccountId: 'bank' }),
      income({ amount: 20, exclude: true }),
      income({ amount: 300, date: '2026-10-31T23:00:00+08:00' }),
    ],
  );
  const plan = computePlan(buildIndex(data, NOW), NOV, 1000);

  it('sums spending by category, leaving out excluded, uncategorised and future rows', () => {
    expect(plan.spent).toBe(80);
    expect(plan.uncategorisedSpent).toBe(15);
    const food = plan.expenseCategories.find((c) => c.category.id === 'food')!;
    expect(food).toMatchObject({ spent: 20, limit: 350, left: 330 });
    expect(plan.expenseCategories.find((c) => c.category.id === 'invest-x')!.spent).toBe(0);
  });

  it('counts only income-type categories as received', () => {
    expect(plan.received).toBe(5200);
    expect(plan.incomeCategories.find((c) => c.category.id === 'cardpay')).toMatchObject({
      received: 250.5,
      counted: false,
    });
  });

  it('derives the plan figures', () => {
    expect(plan.incomeTarget).toBe(6000);
    expect(plan.spendingBudget).toBe(1500);
    expect(plan.budgetLeft).toBe(1420);
    expect(plan.saved).toBe(5120);
    expect(plan.unallocated).toBe(3500); // 6000 − 1500 − 1000
  });

  it('orders categories by their numeric prefix', () => {
    expect(plan.expenseCategories.map((c) => c.category.id)).toEqual(['food', 'invest-x', 'travel']);
  });

  it('assigns rows to months by local time', () => {
    // 16:30 UTC on 31 Oct is 00:30 on 1 Nov in Singapore.
    const ix = buildIndex(base([expense({ amount: 9, date: '2026-10-31T16:30:00Z' })]), NOW);
    expect(computePlan(ix, NOV, 0).spent).toBe(9);
    expect(computePlan(ix, NOV - 1, 0).spent).toBe(0);
  });

  it('drops the limit of archived categories but still shows their spending', () => {
    const d2 = base([expense({ amount: 30, categoryId: 'travel' })]);
    d2.expenseCategories.find((c) => c.id === 'travel')!.archived = true;
    const p2 = computePlan(buildIndex(d2, NOW), NOV, 0);
    expect(p2.spendingBudget).toBe(1350);
    expect(p2.spent).toBe(30);
  });
});

describe('balances and net worth', () => {
  const data = base(
    [
      expense({ amount: 50, paymentMethodId: 'pm-bank' }),
      expense({ amount: 30, paymentMethodId: 'pm-paynow' }),
      expense({ amount: 120, paymentMethodId: 'pm-card' }),
      // Buying investments: out of the bank, into the broker. Don't Include still moves balances.
      expense({ amount: 2000, categoryId: 'invest-x', exclude: true, targetAccountId: 'broker' }),
    ],
    [
      income({ amount: 5200, paymentMethodId: 'pm-bank' }),
      // Paying the card: Account (+) is the card, Source Asset (−) is the bank.
      income({ amount: 100, categoryId: 'cardpay', paymentMethodId: 'pm-card', sourceAccountId: 'bank' }),
      // Selling a holding: money lands in the bank, value leaves the broker.
      income({ amount: 300, paymentMethodId: 'pm-bank', sourceAccountId: 'broker' }),
    ],
  );
  const ix = buildIndex(data, NOW);
  const balances = computeBalances(ix);

  it('moves the account linked to each payment method', () => {
    expect(balances.get('bank')).toMatchObject({ payOut: 2080, payIn: 5500, transOut: 100, current: 4320 });
  });

  it('adds and removes value through target and source assets', () => {
    expect(balances.get('broker')).toMatchObject({ transIn: 2000, transOut: 300, current: 6700, growth: 1700 });
  });

  it('shows what is owed on a card as a negative balance', () => {
    expect(balances.get('card')!.current).toBe(-20);
  });

  it('adds up net worth by type and category', () => {
    const nw = computeNetWorth(ix, balances);
    expect(nw).toMatchObject({ assets: 11020, liabilities: -20, netWorth: 11000 });
    expect(nw.assetCategories.map((c) => [c.category?.id, c.total])).toEqual([
      ['invest', 6700],
      ['liquid', 4320],
    ]);
    expect(nw.assetCategories[0].share).toBeCloseTo(6700 / 11020);
  });

  it('leaves out accounts that are not counted or archived', () => {
    const d2 = base();
    d2.accounts[1].inNetWorth = false;
    const i2 = buildIndex(d2, NOW);
    expect(computeNetWorth(i2, computeBalances(i2)).assets).toBe(1000);
  });

  it('produces checkup ratios', () => {
    const c = computeCheckup(ix, computeNetWorth(ix, balances));
    expect(c.liquid).toBe(4320);
    expect(c.investment).toBe(6700);
    expect(c.debtToAsset).toBeCloseTo(20 / 11020);
    expect(c.solvencyRatio).toBeCloseTo(11000 / 11020);
  });
});

describe('checks', () => {
  it('flags income rows that are missing something', () => {
    const data = base(
      [expense({ id: 'bill' })],
      [
        income({ id: 'ok' }),
        income({ id: 'nosrc', categoryId: 'transfer' }),
        income({ id: 'wrongcard', categoryId: 'cardpay', paymentMethodId: 'pm-bank', sourceAccountId: 'bank' }),
        income({ id: 'unlinked', categoryId: 'refund' }),
        income({ id: 'linked', categoryId: 'refund', expenseId: 'bill' }),
        income({ id: 'nocat', categoryId: null, amount: 0, paymentMethodId: null }),
      ],
    );
    const ix = buildIndex(data, NOW);
    const issues = Object.fromEntries(ix.incomes.map((i) => [i.income.id, incomeIssues(ix, i)]));
    expect(issues).toEqual({
      ok: [],
      nosrc: ['No source'],
      wrongcard: ['Wrong card'],
      unlinked: ['Not linked'],
      linked: [],
      nocat: ['No category', 'No account', 'No amount'],
    });
  });

  it('flags expense rows that are missing something', () => {
    const data = base([
      expense({ id: 'ok' }),
      expense({ id: 'nocat', categoryId: null }),
      expense({ id: 'topup', categoryId: null, targetAccountId: 'broker' }),
      expense({ id: 'noacct', paymentMethodId: null }),
      expense({ id: 'zero', amount: 0 }),
    ]);
    const ix = buildIndex(data, NOW);
    const issues = Object.fromEntries(ix.expenses.map((e) => [e.expense.id, expenseIssues(ix, e)]));
    expect(issues).toEqual({ ok: [], nocat: ['No category'], topup: [], noacct: ['No account'], zero: ['No amount'] });
  });

  it('only checks rows entered since the cut-over date', () => {
    const data = base([
      expense({ id: 'old', categoryId: null, createdAt: '2026-10-01T00:00:00Z' }),
      expense({ id: 'new', categoryId: null, createdAt: '2026-11-12T00:00:00Z' }),
    ]);
    const ix = buildIndex(data, NOW);
    expect(fixList(ix, '2026-10-11T00:00:00Z').map((f) => f.id)).toEqual(['new']);
    expect(fixList(ix, null).map((f) => f.id).sort()).toEqual(['new', 'old']);
  });
});

describe('entry helpers', () => {
  it('parses amounts and simple sums', () => {
    expect(parseAmount('12.5')).toBe(12.5);
    expect(parseAmount(' S$1,234.50 ')).toBe(1234.5);
    expect(parseAmount('12.50+3.20')).toBe(15.7);
    expect(parseAmount('45/3')).toBe(15);
    expect(parseAmount('10+2*3-1')).toBe(15);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1/0')).toBeNull();
    expect(parseAmount('5+')).toBeNull();
  });

  it('suggests past names, most used first', () => {
    const rows = [
      expense({ name: 'train', amount: 2.42, date: '2026-11-12T08:00:00+08:00' }),
      expense({ name: 'train', amount: 2.66, date: '2026-11-13T08:00:00+08:00' }),
      expense({ name: 'TRAIN', amount: 2.5, date: '2026-11-01T08:00:00+08:00' }),
      expense({ name: 'coffee', amount: 4.8 }),
      expense({ name: 'corner store', amount: 0.55 }),
    ];
    const all = nameSuggestions(rows);
    expect(all[0]).toMatchObject({ name: 'train', count: 3 });
    expect(all[0].last.amount).toBe(2.66);
    expect(matchSuggestions(all, 'c').map((s) => s.name)).toEqual(['coffee', 'corner store']);
    expect(matchSuggestions(all, 'stor').map((s) => s.name)).toEqual(['corner store']);
    expect(matchSuggestions(all, 'train')).toEqual([]); // nothing to suggest once it is typed in full
  });
});

describe('recurring entries', () => {
  const rule = (over: Partial<Recurring>): Recurring => ({
    id: 'r',
    kind: 'expense',
    name: 'spotify',
    amount: 9.9,
    categoryId: 'food',
    paymentMethodId: 'pm-card',
    dayOfMonth: 5,
    active: true,
    lastRun: null,
    ...over,
  });

  it('is due once its day has arrived', () => {
    expect(dueRecurring([rule({ dayOfMonth: 20 })], NOW)).toEqual([]);
    const due = dueRecurring([rule({})], NOW);
    expect(due.map((d) => d.month)).toEqual(['2026-11']);
    expect(due[0].date.getDate()).toBe(5);
  });

  it('does not repeat a month and catches up missed ones', () => {
    expect(dueRecurring([rule({ lastRun: '2026-11' })], NOW)).toEqual([]);
    expect(dueRecurring([rule({ lastRun: '2026-08' })], NOW).map((d) => d.month)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('uses the last day in shorter months and skips paused rules', () => {
    const feb = dueRecurring([rule({ dayOfMonth: 31, lastRun: '2027-01' })], new Date('2027-02-28T12:00:00+08:00'));
    expect(feb[0].date.getDate()).toBe(28);
    expect(dueRecurring([rule({ active: false })], NOW)).toEqual([]);
  });
});
