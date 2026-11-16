/**
 * Single source of truth for the data model. The same spec drives the
 * Postgres DDL, server-side validation of sync operations and the client types.
 *
 * Every table also has the bookkeeping columns: id (text pk), rev (bigint),
 * deleted (boolean) and updated_at (timestamptz).
 */

export type ColType = 'text' | 'num' | 'int' | 'bool' | 'ts' | 'date' | 'json';

export interface ColSpec {
  type: ColType;
  /** Allow NULL. Non-nullable columns fall back to `def` when a value is missing. */
  nullable?: boolean;
  def?: string | number | boolean;
  /** Restrict a text column to these values. */
  oneOf?: readonly string[];
}

const text = (def = ''): ColSpec => ({ type: 'text', def });
const ref = (): ColSpec => ({ type: 'text', nullable: true });
const money = (): ColSpec => ({ type: 'num', def: 0 });
const flag = (def = false): ColSpec => ({ type: 'bool', def });
const pick = (values: readonly string[], def: string): ColSpec => ({ type: 'text', def, oneOf: values });

export const ACCOUNT_TYPES = ['asset', 'liability'] as const;
export const ASSET_KINDS = ['liquid', 'investment', 'physical', 'other', 'short', 'medium', 'long'] as const;
export const PAYMENT_TYPES = ['bank', 'ewallet', 'card', 'cash'] as const;
export const INCOME_TYPES = ['income', 'transfer', 'card_payment', 'reimbursement'] as const;
export const TODO_STATUSES = ['not_started', 'in_progress', 'done'] as const;
export const TODO_TAGS = ['task', 'reminder'] as const;
export const ROW_SOURCES = ['app', 'notion', 'recurring'] as const;
export const RECURRING_KINDS = ['expense', 'income'] as const;

export const TABLES = {
  assetCategories: {
    name: text(),
    type: pick(ACCOUNT_TYPES, 'asset'),
    kind: pick(ASSET_KINDS, 'other'),
  },
  accounts: {
    name: text(),
    type: pick(ACCOUNT_TYPES, 'asset'),
    categoryId: ref(),
    initialValue: money(),
    purchasedDate: { type: 'date', nullable: true },
    inNetWorth: flag(true),
    archived: flag(),
  },
  paymentMethods: {
    name: text(),
    type: pick(PAYMENT_TYPES, 'bank'),
    accountId: ref(),
    archived: flag(),
  },
  expenseCategories: {
    name: text(),
    budgetLimit: money(),
    archived: flag(),
  },
  incomeCategories: {
    name: text(),
    type: pick(INCOME_TYPES, 'income'),
    target: money(),
    archived: flag(),
  },
  expenses: {
    name: text(),
    amount: money(),
    date: { type: 'ts' },
    categoryId: ref(),
    paymentMethodId: ref(),
    targetAccountId: ref(),
    myShare: { type: 'num', nullable: true },
    splitWith: text(),
    spreadMonths: { type: 'int', nullable: true },
    exclude: flag(),
    createdAt: { type: 'ts' },
    source: pick(ROW_SOURCES, 'app'),
  },
  incomes: {
    name: text(),
    amount: money(),
    date: { type: 'ts' },
    categoryId: ref(),
    paymentMethodId: ref(),
    sourceAccountId: ref(),
    expenseId: ref(),
    exclude: flag(),
    createdAt: { type: 'ts' },
    source: pick(ROW_SOURCES, 'app'),
  },
  todos: {
    name: text(),
    status: pick(TODO_STATUSES, 'not_started'),
    tag: pick(TODO_TAGS, 'task'),
    dueDate: { type: 'date', nullable: true },
    createdAt: { type: 'ts' },
  },
  recurring: {
    kind: pick(RECURRING_KINDS, 'expense'),
    name: text(),
    amount: money(),
    categoryId: ref(),
    paymentMethodId: ref(),
    dayOfMonth: { type: 'int', def: 1 },
    active: flag(true),
    /** Last month (YYYY-MM) an entry was generated for. */
    lastRun: { type: 'text', nullable: true },
  },
  /** Key/value settings; the row id is the key. */
  settings: {
    value: { type: 'json', nullable: true },
  },
} as const satisfies Record<string, Record<string, ColSpec>>;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export function isTableName(v: unknown): v is TableName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TABLES, v);
}

export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/* ---------- Row types ---------- */

type Base = { id: string };

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type IncomeType = (typeof INCOME_TYPES)[number];
export type TodoStatus = (typeof TODO_STATUSES)[number];
export type TodoTag = (typeof TODO_TAGS)[number];
export type RowSource = (typeof ROW_SOURCES)[number];

export interface AssetCategory extends Base {
  name: string;
  type: AccountType;
  kind: AssetKind;
}
export interface Account extends Base {
  name: string;
  type: AccountType;
  categoryId: string | null;
  initialValue: number;
  purchasedDate: string | null;
  inNetWorth: boolean;
  archived: boolean;
}
export interface PaymentMethod extends Base {
  name: string;
  type: PaymentType;
  accountId: string | null;
  archived: boolean;
}
export interface ExpenseCategory extends Base {
  name: string;
  budgetLimit: number;
  archived: boolean;
}
export interface IncomeCategory extends Base {
  name: string;
  type: IncomeType;
  target: number;
  archived: boolean;
}
export interface Expense extends Base {
  name: string;
  amount: number;
  /** ISO timestamp */
  date: string;
  categoryId: string | null;
  /** "Account (−)": what it was paid with */
  paymentMethodId: string | null;
  /** "Target Asset (+)": account whose value this purchase increases */
  targetAccountId: string | null;
  /** null = all mine; 0 = all for others */
  myShare: number | null;
  splitWith: string;
  /** null/1 = not spread */
  spreadMonths: number | null;
  /** "Don't Include" */
  exclude: boolean;
  createdAt: string;
  source: RowSource;
}
export interface Income extends Base {
  name: string;
  amount: number;
  date: string;
  categoryId: string | null;
  /** "Account (+)": where the money landed */
  paymentMethodId: string | null;
  /** "Source Asset (−)": account the money came out of (transfers, card payments, sales) */
  sourceAccountId: string | null;
  /** "For Expense": the bill this repays / refunds */
  expenseId: string | null;
  exclude: boolean;
  createdAt: string;
  source: RowSource;
}
export interface Todo extends Base {
  name: string;
  status: TodoStatus;
  tag: TodoTag;
  dueDate: string | null;
  createdAt: string;
}
export interface Recurring extends Base {
  kind: 'expense' | 'income';
  name: string;
  amount: number;
  categoryId: string | null;
  paymentMethodId: string | null;
  dayOfMonth: number;
  active: boolean;
  lastRun: string | null;
}
export interface Setting extends Base {
  value: unknown;
}

export interface RowTypes {
  assetCategories: AssetCategory;
  accounts: Account;
  paymentMethods: PaymentMethod;
  expenseCategories: ExpenseCategory;
  incomeCategories: IncomeCategory;
  expenses: Expense;
  incomes: Income;
  todos: Todo;
  recurring: Recurring;
  settings: Setting;
}

export type Tables = { [K in TableName]: Record<string, RowTypes[K]> };

export function emptyTables(): Tables {
  const t = {} as Record<string, Record<string, unknown>>;
  for (const name of TABLE_NAMES) t[name] = {};
  return t as Tables;
}

/** A change to one row. `data: null` deletes the row. */
export interface Op {
  /** Unique per mutation, so the client can tell which ops a response covered. */
  opId: string;
  table: TableName;
  id: string;
  data: Record<string, unknown> | null;
}

export interface SyncRequest {
  since: number;
  ops: Op[];
}

export interface SyncResponse {
  cursor: number;
  /** Changed rows since `since`, including tombstones (`deleted: true`). */
  rows: Partial<Record<TableName, Array<Record<string, unknown>>>>;
}

/** Well-known settings keys. */
export const SETTING = {
  savingsTarget: 'savingsTarget',
  currency: 'currency',
  /** Only rows created on/after this ISO date are checked by the "Fix" lists. */
  fixSince: 'fixSince',
} as const;
