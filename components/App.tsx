'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useDerived } from '@/lib/derive';
import { back, go, initNav, openSheet, useNav, type EntryMode, type SheetSpec } from '@/lib/nav';
import { init, signIn, sync, useStore } from '@/lib/store';
import { EntrySheet } from './Entry';
import {
  AccountSettingsPage,
  BudgetPage,
  CheckupPage,
  DataPage,
  HelpPage,
  ImportSheet,
  MorePage,
  RecurringPage,
  TodosPage,
  seedDefaults,
} from './more';
import { AccountPage, AccountsPage, AllPage, ExpensePage, IncomePage, TodayPage } from './pages';
import {
  AccountSheet,
  AssetCategorySheet,
  ExpenseCategorySheet,
  IncomeCategorySheet,
  PaymentMethodSheet,
  RecurringSheet,
  SyncSheet,
  TodoSheet,
} from './sheets';
import { Card, Icon } from './ui';

const TABS = [
  { route: '/', label: 'Today', icon: 'home' },
  { route: '/expense', label: 'Expense', icon: 'up' },
  { route: '/income', label: 'Income', icon: 'down' },
  { route: '/accounts', label: 'Accounts', icon: 'wallet' },
  { route: '/more', label: 'More', icon: 'menu' },
] as const;

interface Screen {
  title: string;
  tab: string;
  /** Sub-pages show a back button leading here. */
  parent?: string;
  body: ReactNode;
}

function resolve(route: string, accountName: (id: string) => string): Screen {
  const account = route.match(/^\/account\/(.+)$/);
  if (account) {
    const id = decodeURIComponent(account[1]);
    return { title: accountName(id), tab: '/accounts', parent: '/accounts', body: <AccountPage key={id} id={id} /> };
  }
  switch (route) {
    case '/expense':
      return { title: 'Expense', tab: route, body: <ExpensePage /> };
    case '/expense/all':
      return { title: 'All expenses', tab: '/expense', parent: '/expense', body: <AllPage kind="expense" /> };
    case '/income':
      return { title: 'Income', tab: route, body: <IncomePage /> };
    case '/income/all':
      return { title: 'All income', tab: '/income', parent: '/income', body: <AllPage kind="income" /> };
    case '/accounts':
      return { title: 'Accounts', tab: route, body: <AccountsPage /> };
    case '/more':
      return { title: 'More', tab: route, body: <MorePage /> };
    case '/more/todos':
      return { title: 'To do', tab: '/more', parent: '/more', body: <TodosPage /> };
    case '/more/checkup':
      return { title: 'Financial checkup', tab: '/more', parent: '/more', body: <CheckupPage /> };
    case '/more/budget':
      return { title: 'Budget & categories', tab: '/more', parent: '/more', body: <BudgetPage /> };
    case '/more/accounts':
      return { title: 'Payment methods', tab: '/more', parent: '/more', body: <AccountSettingsPage /> };
    case '/more/recurring':
      return { title: 'Recurring', tab: '/more', parent: '/more', body: <RecurringPage /> };
    case '/more/data':
      return { title: 'Import & backup', tab: '/more', parent: '/more', body: <DataPage /> };
    case '/more/help':
      return { title: 'How I log things', tab: '/more', parent: '/more', body: <HelpPage /> };
    default:
      return { title: 'Today', tab: '/', body: <TodayPage /> };
  }
}

function SheetHost({ spec }: { spec: SheetSpec }) {
  switch (spec.type) {
    case 'entry':
      return <EntrySheet spec={spec} />;
    case 'account':
      return <AccountSheet spec={spec} />;
    case 'assetCategory':
      return <AssetCategorySheet spec={spec} />;
    case 'expenseCategory':
      return <ExpenseCategorySheet spec={spec} />;
    case 'incomeCategory':
      return <IncomeCategorySheet spec={spec} />;
    case 'paymentMethod':
      return <PaymentMethodSheet spec={spec} />;
    case 'todo':
      return <TodoSheet spec={spec} />;
    case 'recurring':
      return <RecurringSheet spec={spec} />;
    case 'import':
      return <ImportSheet />;
    case 'sync':
      return <SyncSheet />;
  }
}

function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(await signIn(password));
          setBusy(false);
        }}
      >
        <div className="login-mark" aria-hidden="true">
          $
        </div>
        <h1>My Finance</h1>
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" className="btn primary block" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <p className="note">You stay signed in on this device.</p>
      </form>
    </main>
  );
}

function Onboarding() {
  return (
    <Card className="onboard">
      <h2>Welcome. Let’s bring your data in.</h2>
      <p>Import everything from your My Finance workspace in Notion, or start from a clean slate.</p>
      <div className="stack">
        <button type="button" className="btn primary" onClick={() => openSheet({ type: 'import' })}>
          Import from Notion
        </button>
        <button type="button" className="btn" onClick={seedDefaults}>
          Start fresh with default categories
        </button>
      </div>
    </Card>
  );
}

function Shell() {
  const s = useStore();
  const nav = useNav();
  const d = useDerived();
  const screen = resolve(nav.route, (id) => d.ix.accountById.get(id)?.name ?? 'Account');
  const isEmpty = !d.data.expenseCategories.length && !d.data.accounts.length && !d.data.paymentMethods.length;
  const fabMode: EntryMode = screen.tab === '/income' ? 'income' : 'expense';

  // Launcher shortcuts ("Add expense") open straight into the form.
  useEffect(() => {
    const add = new URLSearchParams(location.search).get('add');
    if (!add) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (!isEmpty) openSheet({ type: 'entry', mode: add === 'income' ? 'income' : 'expense' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status = s.stuck ? 'stuck' : !s.online ? 'offline' : s.outbox.length ? 'pending' : 'ok';

  return (
    <div className="app">
      <header className="topbar">
        {screen.parent ? (
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => back(screen.parent)}>
            <Icon name="left" />
          </button>
        ) : null}
        <h1>{screen.title}</h1>
        <button
          type="button"
          className={`sync-pill ${status}`}
          aria-label="Sync status"
          onClick={() => openSheet({ type: 'sync' })}
        >
          <Icon name={status === 'offline' ? 'offline' : status === 'stuck' ? 'alert' : 'cloud'} size={18} />
          {status === 'offline'
            ? s.outbox.length
              ? `Offline · ${s.outbox.length} saved`
              : 'Offline'
            : status === 'stuck'
              ? 'Needs attention'
              : status === 'pending'
                ? 'Saving…'
                : null}
        </button>
      </header>

      <main className="page">
        {isEmpty && nav.route === '/' ? <Onboarding /> : null}
        {screen.body}
      </main>

      {!isEmpty && screen.tab !== '/more' ? (
        <button
          type="button"
          className="fab"
          aria-label={fabMode === 'income' ? 'Add income' : 'Add expense'}
          onClick={() => openSheet({ type: 'entry', mode: fabMode })}
        >
          <Icon name="plus" size={26} />
        </button>
      ) : null}

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.route}
            type="button"
            className={screen.tab === t.route ? 'on' : ''}
            aria-current={screen.tab === t.route ? 'page' : undefined}
            onClick={() => go(t.route, { replace: true })}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {nav.sheets.map((spec, i) => (
        <SheetHost key={i} spec={spec} />
      ))}
      {nav.toast ? (
        <div key={nav.toast.id} className="toast" role="status">
          {nav.toast.text}
        </div>
      ) : null}
    </div>
  );
}

function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      // Files fetched before the worker took control are not in its cache yet: hand it the list.
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && (u.includes('/_next/static/') || u.includes('/icons/')));
      reg.active?.postMessage({ type: 'precache', urls: ['/', ...urls] });
    })
    .catch(() => {});
}

export default function App() {
  const s = useStore();
  useEffect(() => {
    initNav();
    void init();
    registerServiceWorker();
  }, []);

  if (!s.ready) return <div className="splash" aria-busy="true" />;
  if (s.authed === false) return <Login />;
  if (!s.hasData) {
    return (
      <div className="splash">
        {s.online && !s.error ? (
          <p>Loading your data…</p>
        ) : (
          <>
            <p>{s.error ?? 'You are offline, and this device has no data yet.'}</p>
            <button type="button" className="btn" onClick={() => void sync()}>
              Try again
            </button>
          </>
        )}
      </div>
    );
  }
  return <Shell />;
}
