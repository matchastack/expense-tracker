'use client';

/**
 * Local-first client store.
 *
 * The whole dataset lives in memory and in IndexedDB, so the app opens and
 * computes everything without waiting for the network. Changes are applied
 * locally straight away, queued in an outbox (kept in localStorage so a queued
 * entry survives the app being closed immediately), and pushed to the server
 * in the background. The same request pulls whatever changed elsewhere.
 */
import { useSyncExternalStore } from 'react';
import { dueRecurring } from './finance';
import { idbDelete, idbGet, idbSet } from './idb';
import {
  TABLE_NAMES,
  emptyTables,
  isTableName,
  type Expense,
  type Income,
  type Op,
  type Recurring,
  type RowTypes,
  type SyncResponse,
  type TableName,
  type Tables,
} from './schema';

export interface State {
  /** Local cache has been read. */
  ready: boolean;
  /** null until the server has answered once. */
  authed: boolean | null;
  /** True once this device has data from the server (now or from an earlier visit). */
  hasData: boolean;
  tables: Tables;
  cursor: number;
  outbox: Op[];
  syncing: boolean;
  online: boolean;
  lastSync: number | null;
  error: string | null;
  /** The server refused the queued changes; retrying will not help. */
  stuck: boolean;
}

const CACHE_KEY = 'cache';
const OUTBOX_KEY = 'mf.outbox';

let state: State = {
  ready: false,
  authed: null,
  hasData: false,
  tables: emptyTables(),
  cursor: 0,
  outbox: [],
  syncing: false,
  online: true,
  lastSync: null,
  error: null,
  stuck: false,
};

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export const getState = () => state;
export const useStore = () => useSyncExternalStore(subscribe, getState, getState);

export const newId = () => crypto.randomUUID();

/* ---------- Pure helpers ---------- */

/** Apply local changes on top of a set of tables. */
export function applyLocalOps(tables: Tables, ops: Op[]): Tables {
  if (!ops.length) return tables;
  const next = { ...tables } as Record<TableName, Record<string, unknown>>;
  const copied = new Set<TableName>();
  for (const op of ops) {
    if (!copied.has(op.table)) {
      next[op.table] = { ...next[op.table] };
      copied.add(op.table);
    }
    if (op.data === null) delete next[op.table][op.id];
    else next[op.table][op.id] = { ...op.data, id: op.id };
  }
  return next as Tables;
}

/** Merge rows from the server (which wins), dropping tombstones. */
export function mergeServerRows(tables: Tables, rows: SyncResponse['rows']): Tables {
  const next = { ...tables } as Record<TableName, Record<string, unknown>>;
  for (const [table, list] of Object.entries(rows)) {
    if (!isTableName(table) || !list?.length) continue;
    const copy = { ...next[table] };
    for (const row of list) {
      const id = String(row.id);
      if (row.deleted) delete copy[id];
      else copy[id] = row;
    }
    next[table] = copy;
  }
  return next as Tables;
}

/* ---------- Persistence ---------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    idbSet(CACHE_KEY, { tables: state.tables, cursor: state.cursor, lastSync: state.lastSync }).catch(() => {});
  }, 300);
}

function saveOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(state.outbox));
  } catch {
    /* storage full or unavailable: the outbox still lives in memory */
  }
}

function loadOutbox(): Op[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((o) => o && isTableName(o.table) && typeof o.id === 'string') : [];
  } catch {
    return [];
  }
}

/* ---------- Mutations ---------- */

let inFlight = new Set<string>();

function commit(ops: Op[]) {
  // A newer change to the same row replaces a queued one that has not been sent yet.
  const replaced = new Set(ops.map((o) => `${o.table}/${o.id}`));
  const outbox = state.outbox.filter((o) => inFlight.has(o.opId) || !replaced.has(`${o.table}/${o.id}`));
  set({ tables: applyLocalOps(state.tables, ops), outbox: [...outbox, ...ops], stuck: false });
  saveOutbox();
  saveCache();
  scheduleSync(250);
}

const toOp = (table: TableName, row: { id: string }): Op => {
  const { id, ...data } = row;
  return { opId: newId(), table, id, data };
};

/** Create or replace a row. */
export function put<K extends TableName>(table: K, row: RowTypes[K]) {
  commit([toOp(table, row)]);
}

/** Change some fields of an existing row. */
export function patch<K extends TableName>(table: K, id: string, changes: Partial<RowTypes[K]>) {
  const current = state.tables[table][id];
  if (!current) return;
  commit([toOp(table, { ...current, ...changes, id })]);
}

export function remove(table: TableName, id: string) {
  commit([{ opId: newId(), table, id, data: null }]);
}

export function putMany(rows: Array<{ table: TableName; row: { id: string } }>) {
  if (rows.length) commit(rows.map((r) => toOp(r.table, r.row)));
}

export function setSetting(key: string, value: unknown) {
  put('settings', { id: key, value });
}

/* ---------- Sync ---------- */

const MAX_BATCH = 500;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

function scheduleSync(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void sync();
  }, delay);
}

export function sync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = doSync().finally(() => {
    running = null;
    if (again) {
      again = false;
      scheduleSync(0);
    }
  });
  return running;
}

async function doSync() {
  if (!state.ready || state.stuck) return;
  const sending = state.outbox.slice(0, MAX_BATCH);
  inFlight = new Set(sending.map((o) => o.opId));
  set({ syncing: true });
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: state.cursor, ops: sending }),
    });
    if (res.status === 401) {
      set({ authed: false, syncing: false });
      return;
    }
    if (!res.ok) {
      const message = (await res.json().catch(() => null))?.error ?? `Sync failed (${res.status})`;
      const refused = sending.length > 0 && res.status >= 400 && res.status < 500 && res.status !== 429;
      set({ syncing: false, error: message, stuck: refused, authed: state.authed ?? true });
      if (!refused) retryLater();
      return;
    }
    const body = (await res.json()) as SyncResponse;
    const outbox = state.outbox.filter((o) => !inFlight.has(o.opId));
    const tables = applyLocalOps(mergeServerRows(state.tables, body.rows), outbox);
    failures = 0;
    set({
      tables,
      outbox,
      cursor: body.cursor,
      authed: true,
      hasData: true,
      syncing: false,
      online: true,
      lastSync: Date.now(),
      error: null,
    });
    saveOutbox();
    saveCache();
    if (outbox.length) again = true; // more queued than fits in one request
    runRecurring();
  } catch {
    // Network failure: keep working from the cache and try again later.
    set({ syncing: false, online: false, error: null });
    retryLater();
  } finally {
    inFlight = new Set();
  }
}

function retryLater() {
  failures++;
  scheduleSync(Math.min(60_000, 3_000 * 2 ** Math.min(failures - 1, 5)));
}

/** Create the entries that recurring rules owe up to today. Ids are deterministic, so this is idempotent. */
function runRecurring() {
  const due = dueRecurring(Object.values(state.tables.recurring));
  if (!due.length) return;
  const rows: Array<{ table: TableName; row: { id: string } }> = [];
  const lastRun = new Map<string, string>();
  for (const { rule, month, date } of due) {
    const common = {
      id: `rec-${rule.id}-${month}`,
      name: rule.name,
      amount: rule.amount,
      date: date.toISOString(),
      categoryId: rule.categoryId,
      paymentMethodId: rule.paymentMethodId,
      exclude: false,
      createdAt: new Date().toISOString(),
      source: 'recurring' as const,
    };
    if (rule.kind === 'expense') {
      const row: Expense = { ...common, targetAccountId: null, myShare: null, splitWith: '', spreadMonths: null };
      rows.push({ table: 'expenses', row });
    } else {
      const row: Income = { ...common, sourceAccountId: null, expenseId: null };
      rows.push({ table: 'incomes', row });
    }
    lastRun.set(rule.id, month);
  }
  for (const [id, month] of lastRun) {
    const row: Recurring = { ...state.tables.recurring[id], lastRun: month };
    rows.push({ table: 'recurring', row });
  }
  putMany(rows);
}

/* ---------- Lifecycle ---------- */

let started = false;

export async function init() {
  if (started) return;
  started = true;
  const cached = await idbGet<{ tables?: Partial<Tables>; cursor?: number; lastSync?: number }>(CACHE_KEY).catch(
    () => undefined,
  );
  const outbox = loadOutbox();
  const tables = { ...emptyTables(), ...(cached?.tables ?? {}) } as Tables;
  for (const name of TABLE_NAMES) tables[name] ??= {} as never;
  set({
    ready: true,
    hasData: !!cached?.tables,
    tables: applyLocalOps(tables, outbox),
    cursor: cached?.cursor ?? 0,
    lastSync: cached?.lastSync ?? null,
    outbox,
    online: navigator.onLine,
  });

  window.addEventListener('online', () => {
    set({ online: true });
    scheduleSync(0);
  });
  window.addEventListener('offline', () => set({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.outbox.length) void sync();
  }, 180_000);
  void sync();
}

export async function signIn(password: string): Promise<string | null> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return (await res.json().catch(() => null))?.error ?? 'Could not sign in.';
  } catch {
    return 'You are offline.';
  }
  set({ authed: true });
  await sync();
  return null;
}

/** Forget everything stored on this device (the server copy is untouched). */
async function clearLocal() {
  if (saveTimer) clearTimeout(saveTimer);
  await idbDelete(CACHE_KEY).catch(() => {});
  try {
    localStorage.removeItem(OUTBOX_KEY);
  } catch {
    /* ignore */
  }
  set({ tables: emptyTables(), cursor: 0, outbox: [], hasData: false, lastSync: null, error: null, stuck: false });
}

export async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  await clearLocal();
  set({ authed: false });
}

/** Throw away the local copy and download everything again. */
export async function resetAndResync() {
  await clearLocal();
  await sync();
}

/** Drop queued changes the server refused, then pull the server's version. */
export async function discardPending() {
  set({ outbox: [], stuck: false, error: null, cursor: 0, tables: emptyTables() });
  saveOutbox();
  await sync();
}
