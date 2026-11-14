'use client';

/** Hash-based navigation plus a stack of open sheets, both wired to the browser's back button. */
import { useSyncExternalStore } from 'react';
import type { AccountType, IncomeType } from './schema';

export type EntryMode = 'expense' | IncomeType;

export interface EntryPreset {
  name?: string;
  amount?: number;
  categoryId?: string | null;
  paymentMethodId?: string | null;
  expenseId?: string | null;
}

export type SheetSpec =
  | { type: 'entry'; mode: EntryMode; id?: string; preset?: EntryPreset }
  | { type: 'account'; id?: string; accountType?: AccountType; categoryId?: string | null }
  | { type: 'assetCategory'; id?: string; accountType?: AccountType }
  | { type: 'expenseCategory'; id?: string }
  | { type: 'incomeCategory'; id?: string }
  | { type: 'paymentMethod'; id?: string }
  | { type: 'todo'; id?: string }
  | { type: 'recurring'; id?: string }
  | { type: 'import' }
  | { type: 'sync' };

interface NavState {
  route: string;
  sheets: SheetSpec[];
  toast: { id: number; text: string } | null;
}

const readRoute = () => (typeof location === 'undefined' ? '/' : location.hash.replace(/^#/, '') || '/');

let state: NavState = { route: '/', sheets: [], toast: null };
const listeners = new Set<() => void>();
function set(patch: Partial<NavState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

let wired = false;
export function initNav() {
  if (wired) return;
  wired = true;
  set({ route: readRoute() });
  window.addEventListener('popstate', (e) => {
    const depth = Number((e.state as { sheet?: number } | null)?.sheet ?? 0);
    set({ route: readRoute(), sheets: state.sheets.slice(0, depth) });
    window.scrollTo(0, 0);
  });
}

export function go(route: string, opts: { replace?: boolean } = {}) {
  if (route === state.route && !state.sheets.length) return;
  const url = `#${route}`;
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  set({ route, sheets: [] });
  window.scrollTo(0, 0);
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback, { replace: true });
}

export function openSheet(spec: SheetSpec) {
  const sheets = [...state.sheets, spec];
  history.pushState({ sheet: sheets.length }, '');
  set({ sheets });
}

export function closeSheet() {
  if (!state.sheets.length) return;
  if ((history.state as { sheet?: number } | null)?.sheet === state.sheets.length) history.back();
  else set({ sheets: state.sheets.slice(0, -1) });
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(text: string) {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: { id: Date.now(), text } });
  toastTimer = setTimeout(() => set({ toast: null }), 2200);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => state;
export const useNav = () => useSyncExternalStore(subscribe, snapshot, snapshot);
