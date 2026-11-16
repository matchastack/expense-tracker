/**
 * All the numbers the app shows are derived here, from plain rows, with no I/O.
 * These reproduce the formulas and rollups of the "My Finance" Notion workspace.
 */
import type {
  Account,
  AssetCategory,
  Expense,
  ExpenseCategory,
  Income,
  IncomeCategory,
  IncomeType,
  PaymentMethod,
  Recurring,
} from './schema';

export interface Dataset {
  assetCategories: AssetCategory[];
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  expenseCategories: ExpenseCategory[];
  incomeCategories: IncomeCategory[];
  expenses: Expense[];
  incomes: Income[];
}

export const round2 = (n: number) => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r; // avoid -0
};

/* ---------- Months (device-local time) ---------- */

/** Months since year 0, in local time. Consecutive months differ by 1. */
export const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
export const monthStart = (m: number) => new Date(Math.floor(m / 12), m % 12, 1);
export const monthKey = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
export const parseMonthKey = (key: string) => {
  const [y, mo] = key.split('-').map(Number);
  return y * 12 + (mo - 1);
};

/* ---------- Per-expense figures ---------- */

export interface ExpenseInfo {
  expense: Expense;
  time: number;
  month: number;
  /** Months the cost is spread over (>= 1). */
  months: number;
  /** Repayments and refunds linked to this expense. */
  repaid: number;
  /** What others owe for this expense: Amount − My Share (0 when it is all mine). */
  theirShare: number;
  /** Their Share − Repaid. Above 0 = still owed to me. */
  owed: number;
  /**
   * What this cost me: My Share if set, otherwise Amount; less anything repaid
   * beyond the others' share (i.e. a merchant refund); 0 if Don't Include.
   */
  myCost: number;
}

export interface IncomeInfo {
  income: Income;
  time: number;
  month: number;
  /** From the category. null when uncategorised. */
  type: IncomeType | null;
}

export interface Index {
  now: number;
  data: Dataset;
  expenses: ExpenseInfo[];
  incomes: IncomeInfo[];
  expenseById: Map<string, ExpenseInfo>;
  expenseCategoryById: Map<string, ExpenseCategory>;
  incomeCategoryById: Map<string, IncomeCategory>;
  paymentMethodById: Map<string, PaymentMethod>;
  accountById: Map<string, Account>;
  assetCategoryById: Map<string, AssetCategory>;
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

export function buildIndex(data: Dataset, now: Date = new Date()): Index {
  const repaidBy = new Map<string, number>();
  for (const inc of data.incomes) {
    if (inc.expenseId) repaidBy.set(inc.expenseId, (repaidBy.get(inc.expenseId) ?? 0) + inc.amount);
  }

  const expenses: ExpenseInfo[] = data.expenses.map((expense) => {
    const d = new Date(expense.date);
    const repaid = repaidBy.get(expense.id) ?? 0;
    const split = expense.myShare != null;
    const theirShare = split ? expense.amount - (expense.myShare as number) : 0;
    const base = split ? (expense.myShare as number) : expense.amount;
    const refund = Math.max(0, repaid - theirShare);
    return {
      expense,
      time: d.getTime(),
      month: monthIndex(d),
      months: Math.max(1, Math.floor(expense.spreadMonths ?? 1)),
      repaid: round2(repaid),
      theirShare: round2(theirShare),
      owed: round2(theirShare - repaid),
      myCost: expense.exclude ? 0 : round2(base - refund),
    };
  });

  const incomeCategoryById = byId(data.incomeCategories);
  const incomes: IncomeInfo[] = data.incomes.map((income) => {
    const d = new Date(income.date);
    return {
      income,
      time: d.getTime(),
      month: monthIndex(d),
      type: (income.categoryId && incomeCategoryById.get(income.categoryId)?.type) || null,
    };
  });

  return {
    now: now.getTime(),
    data,
    expenses,
    incomes,
    expenseById: new Map(expenses.map((e) => [e.expense.id, e])),
    expenseCategoryById: byId(data.expenseCategories),
    incomeCategoryById,
    paymentMethodById: byId(data.paymentMethods),
    accountById: byId(data.accounts),
    assetCategoryById: byId(data.assetCategories),
  };
}

/**
 * How much of an expense counts toward month `m`: My Cost, spread at 1/N per
 * month for N months starting in the purchase month. Future-dated rows count
 * only once their date arrives.
 */
export function costInMonth(e: ExpenseInfo, m: number, now: number): number {
  if (e.time > now) return 0;
  const k = m - e.month;
  if (k < 0 || k >= e.months) return 0;
  return e.myCost / e.months;
}

/* ---------- Monthly plan ---------- */

export interface CategorySpend {
  category: ExpenseCategory;
  spent: number;
  limit: number;
  left: number;
  /** spent / limit, or null when there is no limit. */
  progress: number | null;
}

export interface CategoryIncome {
  category: IncomeCategory;
  received: number;
  target: number;
  /** Only Income-type categories count toward Received in the plan. */
  counted: boolean;
}

export interface Plan {
  month: number;
  incomeTarget: number;
  received: number;
  spendingBudget: number;
  spent: number;
  budgetLeft: number;
  saved: number;
  savingsTarget: number;
  unallocated: number;
  /** Spending left out of Spent because the row has no (known) category. */
  uncategorisedSpent: number;
  expenseCategories: CategorySpend[];
  incomeCategories: CategoryIncome[];
}

export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export const byName = <T extends { name: string }>(rows: T[]) =>
  [...rows].sort((a, b) => naturalCompare(a.name, b.name));

export function computePlan(ix: Index, m: number, savingsTarget: number): Plan {
  const spentBy = new Map<string, number>();
  let uncategorisedSpent = 0;
  for (const e of ix.expenses) {
    const cost = costInMonth(e, m, ix.now);
    if (cost === 0) continue;
    const cat = e.expense.categoryId;
    if (cat && ix.expenseCategoryById.has(cat)) spentBy.set(cat, (spentBy.get(cat) ?? 0) + cost);
    else uncategorisedSpent += cost;
  }

  const receivedBy = new Map<string, number>();
  for (const i of ix.incomes) {
    if (i.month !== m || i.income.exclude || i.time > ix.now) continue;
    const cat = i.income.categoryId;
    if (cat && ix.incomeCategoryById.has(cat)) receivedBy.set(cat, (receivedBy.get(cat) ?? 0) + i.income.amount);
  }

  const expenseCategories: CategorySpend[] = byName(ix.data.expenseCategories)
    .filter((c) => !c.archived || spentBy.has(c.id))
    .map((category) => {
      const spent = round2(spentBy.get(category.id) ?? 0);
      const limit = category.archived ? 0 : category.budgetLimit;
      return {
        category,
        spent,
        limit,
        left: round2(limit - spent),
        progress: limit > 0 ? spent / limit : null,
      };
    });

  const incomeCategories: CategoryIncome[] = byName(ix.data.incomeCategories)
    .filter((c) => !c.archived || receivedBy.has(c.id))
    .map((category) => ({
      category,
      received: round2(receivedBy.get(category.id) ?? 0),
      target: category.archived ? 0 : category.target,
      counted: category.type === 'income',
    }));

  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  const spendingBudget = round2(sum(expenseCategories.map((c) => c.limit)));
  const spent = round2(sum([...spentBy.values()]));
  const counted = incomeCategories.filter((c) => c.counted);
  const incomeTarget = round2(sum(counted.map((c) => c.target)));
  const received = round2(sum(counted.map((c) => c.received)));

  return {
    month: m,
    incomeTarget,
    received,
    spendingBudget,
    spent,
    budgetLeft: round2(spendingBudget - spent),
    saved: round2(received - spent),
    savingsTarget,
    unallocated: round2(incomeTarget - spendingBudget - savingsTarget),
    uncategorisedSpent: round2(uncategorisedSpent),
    expenseCategories,
    incomeCategories,
  };
}

/* ---------- Account balances & net worth ---------- */

export interface Balance {
  account: Account;
  /** Expenses that add value to this account (Target Asset +). */
  transIn: number;
  /** Income rows that take value out of this account (Source Asset −). */
  transOut: number;
  /** Money received through payment methods linked to this account. */
  payIn: number;
  /** Money spent through payment methods linked to this account. */
  payOut: number;
  /** Initial + Trans In − Trans Out + Pay In − Pay Out. Negative on a liability = owed. */
  current: number;
  growth: number;
}

export function computeBalances(ix: Index): Map<string, Balance> {
  const out = new Map<string, Balance>();
  for (const account of ix.data.accounts) {
    out.set(account.id, { account, transIn: 0, transOut: 0, payIn: 0, payOut: 0, current: 0, growth: 0 });
  }
  const viaPayment = (pmId: string | null) => {
    const accountId = pmId ? ix.paymentMethodById.get(pmId)?.accountId : null;
    return accountId ? out.get(accountId) : undefined;
  };
  for (const e of ix.data.expenses) {
    const paid = viaPayment(e.paymentMethodId);
    if (paid) paid.payOut += e.amount;
    const target = e.targetAccountId ? out.get(e.targetAccountId) : undefined;
    if (target) target.transIn += e.amount;
  }
  for (const i of ix.data.incomes) {
    const landed = viaPayment(i.paymentMethodId);
    if (landed) landed.payIn += i.amount;
    const source = i.sourceAccountId ? out.get(i.sourceAccountId) : undefined;
    if (source) source.transOut += i.amount;
  }
  for (const b of out.values()) {
    b.transIn = round2(b.transIn);
    b.transOut = round2(b.transOut);
    b.payIn = round2(b.payIn);
    b.payOut = round2(b.payOut);
    b.growth = round2(b.transIn - b.transOut + b.payIn - b.payOut);
    b.current = round2(b.account.initialValue + b.growth);
  }
  return out;
}

export interface CategoryTotal {
  category: AssetCategory | null;
  balances: Balance[];
  total: number;
  /** Share of all assets (or of all liabilities). */
  share: number;
}

export interface NetWorth {
  assets: number;
  /** Negative = owed. */
  liabilities: number;
  netWorth: number;
  assetCategories: CategoryTotal[];
  liabilityCategories: CategoryTotal[];
}

export function computeNetWorth(ix: Index, balances: Map<string, Balance>): NetWorth {
  const groups = { asset: new Map<string, Balance[]>(), liability: new Map<string, Balance[]>() };
  for (const b of balances.values()) {
    if (b.account.archived) continue;
    const key = b.account.categoryId && ix.assetCategoryById.has(b.account.categoryId) ? b.account.categoryId : '';
    const g = groups[b.account.type];
    g.set(key, [...(g.get(key) ?? []), b]);
  }
  const counted = (bs: Balance[]) => bs.filter((b) => b.account.inNetWorth).reduce((a, b) => a + b.current, 0);
  const build = (type: 'asset' | 'liability'): { total: number; cats: CategoryTotal[] } => {
    const cats = [...groups[type].entries()].map(([id, bs]) => ({
      category: id ? ix.assetCategoryById.get(id)! : null,
      balances: [...bs].sort((a, b) => Math.abs(b.current) - Math.abs(a.current)),
      total: round2(counted(bs)),
      share: 0,
    }));
    const total = round2(cats.reduce((a, c) => a + c.total, 0));
    for (const c of cats) c.share = total !== 0 ? c.total / total : 0;
    cats.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return { total, cats };
  };
  const a = build('asset');
  const l = build('liability');
  return {
    assets: a.total,
    liabilities: l.total,
    netWorth: round2(a.total + l.total),
    assetCategories: a.cats,
    liabilityCategories: l.cats,
  };
}

/* ---------- Checks ("Issue" / Fix lists) ---------- */

export function incomeIssues(ix: Index, i: IncomeInfo): string[] {
  const { income } = i;
  const issues: string[] = [];
  if (!i.type) issues.push('No category');
  if (!income.paymentMethodId) issues.push('No account');
  if (!income.amount) issues.push('No amount');
  if ((i.type === 'transfer' || i.type === 'card_payment') && !income.sourceAccountId) issues.push('No source');
  if (i.type === 'card_payment' && income.paymentMethodId) {
    const pm = ix.paymentMethodById.get(income.paymentMethodId);
    if (pm && pm.type !== 'card') issues.push('Wrong card');
  }
  if (i.type === 'reimbursement') {
    if (!income.expenseId) issues.push('Not linked');
    else if (!ix.expenseById.has(income.expenseId)) issues.push('Bill missing');
  }
  return issues;
}

export function expenseIssues(ix: Index, e: ExpenseInfo): string[] {
  const { expense } = e;
  const issues: string[] = [];
  const hasCategory = !!expense.categoryId && ix.expenseCategoryById.has(expense.categoryId);
  if (!hasCategory && !expense.targetAccountId) issues.push('No category');
  if (hasCategory && !expense.paymentMethodId) issues.push('No account');
  if (!expense.amount) issues.push('No amount');
  return issues;
}

export interface FixItem {
  kind: 'expense' | 'income';
  id: string;
  time: number;
  issues: string[];
}

/** Rows that are missing something. Only rows entered on/after `since` are checked. */
export function fixList(ix: Index, since: string | null): FixItem[] {
  const from = since ? new Date(since).getTime() : -Infinity;
  const entered = (createdAt: string) => new Date(createdAt).getTime() >= from;
  const out: FixItem[] = [];
  for (const e of ix.expenses) {
    if (!entered(e.expense.createdAt)) continue;
    const issues = expenseIssues(ix, e);
    if (issues.length) out.push({ kind: 'expense', id: e.expense.id, time: e.time, issues });
  }
  for (const i of ix.incomes) {
    if (!entered(i.income.createdAt)) continue;
    const issues = incomeIssues(ix, i);
    if (issues.length) out.push({ kind: 'income', id: i.income.id, time: i.time, issues });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** Split bills, most owed first. */
export function owedToMe(ix: Index): ExpenseInfo[] {
  return ix.expenses
    .filter((e) => e.expense.myShare != null)
    .sort((a, b) => b.owed - a.owed || b.time - a.time);
}

/* ---------- Entry helpers ---------- */

export interface Suggestion<T = Expense> {
  name: string;
  count: number;
  last: T;
}

/** Past entry names with how often they were used, most frequent first. */
export function nameSuggestions<T extends { name: string; date: string }>(
  rows: T[],
  sinceTime = -Infinity,
): Suggestion<T>[] {
  const map = new Map<string, Suggestion<T> & { lastTime: number }>();
  for (const e of rows) {
    const name = e.name.trim();
    if (!name) continue;
    const t = new Date(e.date).getTime();
    if (t < sinceTime) continue;
    const key = name.toLowerCase();
    const cur = map.get(key);
    if (!cur) map.set(key, { name, count: 1, last: e, lastTime: t });
    else {
      cur.count++;
      if (t > cur.lastTime) {
        cur.last = e;
        cur.lastTime = t;
        cur.name = name;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastTime - a.lastTime);
}

export function matchSuggestions<T>(all: Suggestion<T>[], query: string, limit = 5): Suggestion<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: Suggestion<T>[] = [];
  const contains: Suggestion<T>[] = [];
  for (const s of all) {
    const n = s.name.toLowerCase();
    if (n === q) continue;
    if (n.startsWith(q)) starts.push(s);
    else if (n.includes(q)) contains.push(s);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Evaluate what was typed into an amount box. Accepts plain numbers and simple
 * sums such as "12.50+3.20" or "45/3". Returns null when it is not a number.
 */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[,\s$]/g, '').replace(/^S/i, '');
  if (!s) return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([-+*/](\d+\.?\d*|\.\d+))*$/.test(s)) return null;
  const tokens = s.match(/(\d+\.?\d*|\.\d+)|[-+*/]/g)!;
  let i = 0;
  let sign = 1;
  if (tokens[0] === '-' || tokens[0] === '+') {
    sign = tokens[0] === '-' ? -1 : 1;
    i = 1;
  }
  // Multiplication and division first, then addition and subtraction.
  const terms: number[] = [];
  const ops: string[] = [];
  let cur = sign * Number(tokens[i++]);
  while (i < tokens.length) {
    const op = tokens[i++];
    const n = Number(tokens[i++]);
    if (op === '*') cur *= n;
    else if (op === '/') cur /= n;
    else {
      terms.push(cur);
      ops.push(op);
      cur = n;
    }
  }
  terms.push(cur);
  let total = terms[0];
  for (let k = 0; k < ops.length; k++) total += ops[k] === '+' ? terms[k + 1] : -terms[k + 1];
  return Number.isFinite(total) ? round2(total) : null;
}

/* ---------- Recurring entries ---------- */

export interface DueRecurring {
  rule: Recurring;
  /** YYYY-MM */
  month: string;
  date: Date;
}

/**
 * Entries a recurring rule should have generated by `now` but has not yet.
 * A new rule starts with the current month; missed months are caught up (max 12).
 */
export function dueRecurring(rules: Recurring[], now: Date = new Date()): DueRecurring[] {
  const out: DueRecurring[] = [];
  const current = monthIndex(now);
  for (const rule of rules) {
    if (!rule.active) continue;
    const first = rule.lastRun ? Math.max(parseMonthKey(rule.lastRun) + 1, current - 11) : current;
    for (let m = first; m <= current; m++) {
      const y = Math.floor(m / 12);
      const mo = m % 12;
      const lastDay = new Date(y, mo + 1, 0).getDate();
      const date = new Date(y, mo, Math.min(Math.max(1, rule.dayOfMonth), lastDay), 9, 0, 0);
      if (date.getTime() > now.getTime()) break;
      out.push({ rule, month: monthKey(m), date });
    }
  }
  return out;
}

/* ---------- Financial checkup ---------- */

export interface Checkup {
  netWorth: number;
  assets: number;
  liabilities: number;
  liquid: number;
  investment: number;
  /** Average monthly spending / income over the last three complete months. */
  monthlySpending: number;
  monthlyIncome: number;
  monthlyDebtPayments: number;
  /** Months of spending covered by liquid assets. */
  liquidityRatio: number | null;
  /** (Income − Spending) / Income */
  savingsRatio: number | null;
  /** Liabilities / Assets */
  debtToAsset: number | null;
  /** Net worth / Assets */
  solvencyRatio: number | null;
  /** Investment assets / Net worth */
  investmentRatio: number | null;
  /** Liquid assets / Net worth */
  liquidToNetWorth: number | null;
  /** Debt payments / Income */
  debtServiceRatio: number | null;
}

export function computeCheckup(ix: Index, nw: NetWorth): Checkup {
  const kindTotal = (kind: string) =>
    round2(nw.assetCategories.filter((c) => c.category?.kind === kind).reduce((a, c) => a + c.total, 0));
  const liquid = kindTotal('liquid');
  const investment = kindTotal('investment');

  const current = monthIndex(new Date(ix.now));
  const months = [current - 3, current - 2, current - 1];
  let spending = 0;
  let income = 0;
  let debt = 0;
  for (const m of months) {
    const plan = computePlan(ix, m, 0);
    spending += plan.spent;
    income += plan.received;
    debt += plan.incomeCategories
      .filter((c) => c.category.type === 'card_payment')
      .reduce((a, c) => a + c.received, 0);
  }
  const monthlySpending = round2(spending / months.length);
  const monthlyIncome = round2(income / months.length);
  const monthlyDebtPayments = round2(debt / months.length);
  const owed = Math.abs(Math.min(0, nw.liabilities));
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

  return {
    netWorth: nw.netWorth,
    assets: nw.assets,
    liabilities: nw.liabilities,
    liquid,
    investment,
    monthlySpending,
    monthlyIncome,
    monthlyDebtPayments,
    liquidityRatio: ratio(liquid, monthlySpending),
    savingsRatio: ratio(monthlyIncome - monthlySpending, monthlyIncome),
    debtToAsset: ratio(owed, nw.assets),
    solvencyRatio: ratio(nw.netWorth, nw.assets),
    investmentRatio: ratio(investment, nw.netWorth),
    liquidToNetWorth: ratio(liquid, nw.netWorth),
    debtServiceRatio: ratio(monthlyDebtPayments, monthlyIncome),
  };
}
