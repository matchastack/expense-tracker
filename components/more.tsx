'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useDerived } from '@/lib/derive';
import { byName, computeCheckup } from '@/lib/finance';
import { dateLabel, displayName, money, percent, todayIso } from '@/lib/format';
import { go, openSheet, toast } from '@/lib/nav';
import { SETTING, TABLE_NAMES, isTableName, type TableName } from '@/lib/schema';
import { newId, patch, putMany, setSetting, signOut, sync, useStore } from '@/lib/store';
import { Card, Empty, Icon, Money, SectionHead, Sheet, Tabs } from './ui';

/* ---------- Menu ---------- */

export function MorePage() {
  const s = useStore();
  const d = useDerived();
  const openTodos = d.todos.filter((t) => t.status !== 'done').length;
  const items: Array<{ icon: string; label: string; sub?: string; onClick: () => void }> = [
    { icon: 'list', label: 'To do', sub: openTodos ? `${openTodos} open` : undefined, onClick: () => go('/more/todos') },
    { icon: 'pulse', label: 'Financial checkup', onClick: () => go('/more/checkup') },
    { icon: 'gear', label: 'Budget & categories', sub: 'Limits, targets, savings target', onClick: () => go('/more/budget') },
    {
      icon: 'card',
      label: 'Payment methods & account categories',
      onClick: () => go('/more/accounts'),
    },
    {
      icon: 'repeat',
      label: 'Recurring entries',
      sub: d.recurring.length ? `${d.recurring.filter((r) => r.active).length} active` : 'Subscriptions, salary…',
      onClick: () => go('/more/recurring'),
    },
    { icon: 'download', label: 'Import, backup & preferences', onClick: () => go('/more/data') },
    { icon: 'help', label: 'How I log things', onClick: () => go('/more/help') },
    {
      icon: s.online ? 'cloud' : 'offline',
      label: 'Sync',
      sub: s.outbox.length ? `${s.outbox.length} waiting to send` : s.online ? 'Up to date' : 'Offline',
      onClick: () => openSheet({ type: 'sync' }),
    },
  ];
  return (
    <>
      <Card className="menu">
        {items.map((item) => (
          <button key={item.label} type="button" className="menu-item" onClick={item.onClick}>
            <Icon name={item.icon} />
            <span>
              {item.label}
              {item.sub ? <small>{item.sub}</small> : null}
            </span>
            <Icon name="right" size={18} />
          </button>
        ))}
      </Card>
      <button
        type="button"
        className="btn block"
        onClick={() => {
          const pending = s.outbox.length;
          const warn = pending ? ` ${pending} unsent change(s) on this device will be lost.` : '';
          if (window.confirm(`Sign out on this device?${warn}`)) void signOut();
        }}
      >
        <Icon name="out" size={18} /> Sign out
      </button>
    </>
  );
}

/* ---------- To do ---------- */

export function TodosPage() {
  const d = useDerived();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const today = todayIso(d.now);
  const list = d.todos
    .filter((t) => (tab === 'done' ? t.status === 'done' : t.status !== 'done'))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.name.localeCompare(b.name));
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done' },
        ]}
      />
      <Card>
        {list.length ? (
          <div className="rows">
            {list.map((t) => (
              <div key={t.id} className="todo">
                <button
                  type="button"
                  className={`check ${t.status === 'done' ? 'on' : ''}`}
                  aria-label={t.status === 'done' ? `Reopen "${t.name}"` : `Mark "${t.name}" done`}
                  onClick={() => patch('todos', t.id, { status: t.status === 'done' ? 'not_started' : 'done' })}
                >
                  {t.status === 'done' ? <Icon name="check" size={14} /> : null}
                </button>
                <button type="button" className="todo-main" onClick={() => openSheet({ type: 'todo', id: t.id })}>
                  <span>{t.name}</span>
                  <small className={t.status !== 'done' && t.dueDate && t.dueDate < today ? 'neg' : ''}>
                    {[
                      t.status === 'in_progress' ? 'In progress' : '',
                      t.tag === 'reminder' ? 'Reminder' : 'Task',
                      t.dueDate ? `due ${dateLabel(t.dueDate)}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>{tab === 'open' ? 'Nothing to do.' : 'Nothing done yet.'}</Empty>
        )}
      </Card>
      <button type="button" className="btn block" onClick={() => openSheet({ type: 'todo' })}>
        <Icon name="plus" size={18} /> New to-do
      </button>
    </>
  );
}

/* ---------- Financial checkup ---------- */

export function CheckupPage() {
  const d = useDerived();
  const c = useMemo(() => computeCheckup(d.ix, d.netWorth), [d.ix, d.netWorth]);
  const pct = (v: number | null) => (v === null ? '–' : percent(v));
  const ratios: Array<{ label: string; value: string; note: string }> = [
    {
      label: 'Liquidity',
      value: c.liquidityRatio === null ? '–' : `${c.liquidityRatio.toFixed(1)} months`,
      note: 'How long liquid assets cover your average spending. 3–6 months is a common cushion.',
    },
    {
      label: 'Savings ratio',
      value: pct(c.savingsRatio),
      note: 'Share of income left after spending. A common rule of thumb is 10–20% or more.',
    },
    {
      label: 'Debt to asset',
      value: pct(c.debtToAsset),
      note: 'What you owe as a share of what you own. Lower is safer; under 50% is the usual guide.',
    },
    {
      label: 'Solvency',
      value: pct(c.solvencyRatio),
      note: 'Net worth as a share of assets: how much of what you own is really yours.',
    },
    {
      label: 'Investment ratio',
      value: pct(c.investmentRatio),
      note: 'Investment assets as a share of net worth.',
    },
    {
      label: 'Liquid assets to net worth',
      value: pct(c.liquidToNetWorth),
      note: 'How much of your net worth is readily available cash.',
    },
    {
      label: 'Debt service',
      value: pct(c.debtServiceRatio),
      note: 'Average monthly card payments as a share of income.',
    },
  ];
  return (
    <>
      <Card>
        <SectionHead title="Where you stand" />
        <dl className="facts">
          <div>
            <dt>Net worth</dt>
            <dd>{money(c.netWorth, d.currency)}</dd>
          </div>
          <div>
            <dt>Assets</dt>
            <dd>{money(c.assets, d.currency)}</dd>
          </div>
          <div>
            <dt>Liabilities</dt>
            <dd>{money(c.liabilities, d.currency)}</dd>
          </div>
          <div>
            <dt>Liquid assets</dt>
            <dd>{money(c.liquid, d.currency)}</dd>
          </div>
          <div>
            <dt>Investments</dt>
            <dd>{money(c.investment, d.currency)}</dd>
          </div>
          <div>
            <dt>Avg monthly income</dt>
            <dd>{money(c.monthlyIncome, d.currency)}</dd>
          </div>
          <div>
            <dt>Avg monthly spending</dt>
            <dd>{money(c.monthlySpending, d.currency)}</dd>
          </div>
        </dl>
        <p className="note">Monthly averages use the last three complete months.</p>
      </Card>
      <Card>
        <SectionHead title="Ratios" />
        <div className="ratios">
          {ratios.map((r) => (
            <div key={r.label}>
              <div className="ratio-line">
                <span>{r.label}</span>
                <strong className="num">{r.value}</strong>
              </div>
              <small>{r.note}</small>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ---------- Budget & categories ---------- */

function InlineNumber({
  label,
  value,
  onSave,
  prefix,
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
  prefix: string;
}) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== value) onSave(Math.round(n * 100) / 100);
    else setText(String(value));
  };
  return (
    <label className="inline-number">
      <span>{label}</span>
      <span className="inline-input">
        {prefix}
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
    </label>
  );
}

const AddButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="link" onClick={onClick}>
    {children}
  </button>
);

export function BudgetPage() {
  const d = useDerived();
  const expenseCats = byName(d.data.expenseCategories);
  const incomeCats = byName(d.data.incomeCategories);
  return (
    <>
      <Card>
        <SectionHead title="Plan" />
        <InlineNumber
          label="Savings target (per month)"
          prefix={d.currency}
          value={d.savingsTarget}
          onSave={(v) => {
            setSetting(SETTING.savingsTarget, v);
            toast('Savings target saved');
          }}
        />
        <dl className="facts">
          <div>
            <dt>Income target</dt>
            <dd>{money(d.plan.incomeTarget, d.currency)}</dd>
          </div>
          <div>
            <dt>Spending budget</dt>
            <dd>{money(d.plan.spendingBudget, d.currency)}</dd>
          </div>
          <div>
            <dt>Unallocated</dt>
            <dd>
              <Money value={d.plan.unallocated} currency={d.currency} tone="auto" />
            </dd>
          </div>
        </dl>
        <p className="note">Unallocated = income target − spending budget − savings target. Aim for 0.</p>
      </Card>

      <Card>
        <SectionHead
          title="Expense categories"
          action={<AddButton onClick={() => openSheet({ type: 'expenseCategory' })}>Add</AddButton>}
        />
        <div className="rows">
          {expenseCats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`row ${c.archived ? 'dim' : ''}`}
              onClick={() => openSheet({ type: 'expenseCategory', id: c.id })}
            >
              <span>
                {c.name}
                {c.archived ? <small>archived</small> : null}
              </span>
              <span className="num">{money(c.budgetLimit, d.currency)}</span>
            </button>
          ))}
        </div>
        {!expenseCats.length ? <Empty>No expense categories yet.</Empty> : null}
      </Card>

      <Card>
        <SectionHead
          title="Income categories"
          action={<AddButton onClick={() => openSheet({ type: 'incomeCategory' })}>Add</AddButton>}
        />
        <div className="rows">
          {incomeCats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`row ${c.archived ? 'dim' : ''}`}
              onClick={() => openSheet({ type: 'incomeCategory', id: c.id })}
            >
              <span>
                {c.name}
                <small>
                  {c.type === 'income' ? 'counts as income' : c.type.replace('_', ' ')}
                  {c.archived ? ' · archived' : ''}
                </small>
              </span>
              <span className="num">{c.type === 'income' ? money(c.target, d.currency) : '–'}</span>
            </button>
          ))}
        </div>
        {!incomeCats.length ? <Empty>No income categories yet.</Empty> : null}
      </Card>
    </>
  );
}

/* ---------- Payment methods & account categories ---------- */

export function AccountSettingsPage() {
  const d = useDerived();
  const methods = byName(d.data.paymentMethods);
  const cats = byName(d.data.assetCategories);
  const typeLabel = { bank: 'Bank account', ewallet: 'E-wallet', card: 'Credit card', cash: 'Cash' } as const;
  return (
    <>
      <Card>
        <SectionHead
          title="Payment methods"
          action={<AddButton onClick={() => openSheet({ type: 'paymentMethod' })}>Add</AddButton>}
        />
        <div className="rows">
          {methods.map((p) => {
            const account = p.accountId ? d.ix.accountById.get(p.accountId) : undefined;
            return (
              <button
                key={p.id}
                type="button"
                className={`row ${p.archived ? 'dim' : ''}`}
                onClick={() => openSheet({ type: 'paymentMethod', id: p.id })}
              >
                <span>
                  {p.name}
                  <small className={account ? '' : 'neg'}>
                    {typeLabel[p.type]} · {account ? `moves ${account.name}` : 'not linked to an account'}
                    {p.archived ? ' · archived' : ''}
                  </small>
                </span>
                <Icon name="right" size={18} />
              </button>
            );
          })}
        </div>
        {!methods.length ? <Empty>No payment methods yet.</Empty> : null}
        <p className="note">
          A payment method is what you pick when logging. It must be linked to an account, whose balance it moves.
        </p>
      </Card>

      <Card>
        <SectionHead
          title="Account categories"
          action={<AddButton onClick={() => openSheet({ type: 'assetCategory' })}>Add</AddButton>}
        />
        <div className="rows">
          {cats.map((c) => (
            <button key={c.id} type="button" className="row" onClick={() => openSheet({ type: 'assetCategory', id: c.id })}>
              <span>
                {c.name}
                <small>{c.type === 'asset' ? 'Assets' : 'Liabilities'}</small>
              </span>
              <Icon name="right" size={18} />
            </button>
          ))}
        </div>
        {!cats.length ? <Empty>No account categories yet.</Empty> : null}
        <p className="note">Accounts themselves are added and edited on the Accounts tab.</p>
      </Card>
    </>
  );
}

/* ---------- Recurring ---------- */

export function RecurringPage() {
  const d = useDerived();
  const rules = byName(d.recurring);
  return (
    <>
      <Card>
        <SectionHead
          title="Recurring entries"
          action={<AddButton onClick={() => openSheet({ type: 'recurring' })}>Add</AddButton>}
        />
        <div className="rows">
          {rules.map((r) => {
            const cat = r.categoryId
              ? (r.kind === 'expense' ? d.ix.expenseCategoryById : d.ix.incomeCategoryById).get(r.categoryId)
              : undefined;
            return (
              <button
                key={r.id}
                type="button"
                className={`row ${r.active ? '' : 'dim'}`}
                onClick={() => openSheet({ type: 'recurring', id: r.id })}
              >
                <span>
                  {r.name}
                  <small>
                    {r.kind === 'expense' ? 'Expense' : 'Income'} · day {r.dayOfMonth}
                    {cat ? ` · ${displayName(cat.name)}` : ''}
                    {r.active ? '' : ' · paused'}
                  </small>
                </span>
                <span className="num">{money(r.amount, d.currency)}</span>
              </button>
            );
          })}
        </div>
        {!rules.length ? <Empty>Nothing recurring yet.</Empty> : null}
        <p className="note">
          For monthly subscriptions, rent or salary. The entry is added on its day each month, the next time the app is
          opened, and you can edit it afterwards like any other row.
        </p>
      </Card>
    </>
  );
}

/* ---------- Data ---------- */

const DEFAULT_EXPENSE_CATEGORIES = [
  'Food & Drinks',
  'Transport',
  'Shopping',
  'Bills & Utilities',
  'Groceries',
  'Other Expense',
  'Subscriptions',
  'Investment',
  'Entertainment',
  'Tax',
  'Travel',
];

/** A generic starting set for people who are not importing from Notion. */
export function seedDefaults() {
  const rows: Array<{ table: TableName; row: { id: string } }> = [];
  const add = (table: TableName, row: Record<string, unknown>) => {
    const id = newId();
    rows.push({ table, row: { id, ...row } });
    return id;
  };
  const liquid = add('assetCategories', { name: 'Liquid Asset', type: 'asset', kind: 'liquid' });
  add('assetCategories', { name: 'Investment Asset', type: 'asset', kind: 'investment' });
  add('assetCategories', { name: 'Physical Asset', type: 'asset', kind: 'physical' });
  add('assetCategories', { name: 'Other Asset', type: 'asset', kind: 'other' });
  const short = add('assetCategories', { name: 'Short Term Liability', type: 'liability', kind: 'short' });
  add('assetCategories', { name: 'Med Term Liability', type: 'liability', kind: 'medium' });
  add('assetCategories', { name: 'Long Term Liability', type: 'liability', kind: 'long' });
  const account = (name: string, type: string, categoryId: string) =>
    add('accounts', {
      name,
      type,
      categoryId,
      initialValue: 0,
      purchasedDate: null,
      inNetWorth: true,
      archived: false,
    });
  const cash = account('Cash', 'asset', liquid);
  const bank = account('Bank account', 'asset', liquid);
  const card = account('Credit card', 'liability', short);
  add('paymentMethods', { name: 'Wallet', type: 'cash', accountId: cash, archived: false });
  add('paymentMethods', { name: 'Bank', type: 'bank', accountId: bank, archived: false });
  add('paymentMethods', { name: 'Credit card', type: 'card', accountId: card, archived: false });
  DEFAULT_EXPENSE_CATEGORIES.forEach((name, i) =>
    add('expenseCategories', { name: `${i} | ${name}`, budgetLimit: 0, archived: false }),
  );
  const income: Array<[string, string]> = [
    ['Salary', 'income'],
    ['Bonus', 'income'],
    ['Investment', 'income'],
    ['Other Income', 'income'],
    ['Transfer', 'transfer'],
    ['Credit Card Payment', 'card_payment'],
    ['Reimbursement & Refund', 'reimbursement'],
  ];
  income.forEach(([name, type], i) =>
    add('incomeCategories', { name: `${i + 1} | ${name}`, type, target: 0, archived: false }),
  );
  putMany(rows);
}

export function DataPage() {
  const s = useStore();
  const d = useDerived();
  const fileRef = useRef<HTMLInputElement>(null);
  const [currency, setCurrency] = useState(d.currency);

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ app: 'my-finance', version: 1, exportedAt: new Date().toISOString(), tables: s.tables })], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `my-finance-backup-${todayIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const restoreBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.app !== 'my-finance' || typeof parsed.tables !== 'object') throw new Error('not a backup');
      const rows: Array<{ table: TableName; row: { id: string } }> = [];
      for (const name of TABLE_NAMES) {
        const table = parsed.tables[name];
        if (!table || typeof table !== 'object') continue;
        for (const row of Object.values(table) as Array<{ id?: unknown }>) {
          if (row && typeof row.id === 'string' && isTableName(name)) rows.push({ table: name, row: row as { id: string } });
        }
      }
      if (!rows.length) throw new Error('empty');
      if (!window.confirm(`Restore ${rows.length} rows from this backup? Rows with the same id are overwritten.`)) return;
      putMany(rows);
      toast(`Restored ${rows.length} rows`);
    } catch {
      window.alert('That file is not a My Finance backup.');
    }
  };

  return (
    <>
      <Card>
        <SectionHead title="Import from Notion" />
        <p className="lead">
          Bring over everything from your My Finance workspace: accounts, payment methods, categories with their limits
          and targets, and all expenses and income.
        </p>
        <button type="button" className="btn primary block" onClick={() => openSheet({ type: 'import' })}>
          Import from Notion
        </button>
        <p className="note">
          Safe to run again: rows are matched by their Notion id and updated in place, so you can keep logging in Notion
          and re-import until you switch over.
        </p>
      </Card>

      <Card>
        <SectionHead title="Backup" />
        <div className="stack">
          <button type="button" className="btn" onClick={exportBackup}>
            <Icon name="download" size={18} /> Download backup (JSON)
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Restore from backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void restoreBackup(file);
            }}
          />
        </div>
      </Card>

      <Card>
        <SectionHead title="Preferences" />
        <label className="inline-number">
          <span>Currency symbol</span>
          <span className="inline-input">
            <input
              aria-label="Currency symbol"
              value={currency}
              maxLength={5}
              onChange={(e) => setCurrency(e.target.value)}
              onBlur={() => {
                const v = currency.trim();
                if (v && v !== d.currency) setSetting(SETTING.currency, v);
                else setCurrency(d.currency);
              }}
            />
          </span>
        </label>
        <label className="inline-number">
          <span>
            Check rows entered since
            <small>The ⚠️ Fix list ignores rows entered before this date.</small>
          </span>
          <span className="inline-input">
            <input
              type="date"
              aria-label="Check rows entered since"
              value={d.fixSince ? d.fixSince.slice(0, 10) : ''}
              onChange={(e) =>
                setSetting(SETTING.fixSince, e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null)
              }
            />
          </span>
        </label>
      </Card>

      <Card>
        <SectionHead title="This device" />
        <div className="stack">
          <button type="button" className="btn" onClick={() => openSheet({ type: 'sync' })}>
            Sync status
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const reg = await navigator.serviceWorker?.getRegistration();
              await reg?.update().catch(() => {});
              const keys = await caches.keys().catch(() => []);
              await Promise.all(keys.map((k) => caches.delete(k)));
              location.reload();
            }}
          >
            Update the app now
          </button>
        </div>
      </Card>
    </>
  );
}

/* ---------- Notion import ---------- */

interface Progress {
  key: string;
  label: string;
  count: number;
  done: boolean;
}

export function ImportSheet() {
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<Progress[]>([]);
  const [message, setMessage] = useState('');

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/import/notion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
    return data;
  };

  const run = async () => {
    const secret = token.trim();
    if (!secret) return;
    setPhase('running');
    setMessage('Looking for your Notion databases…');
    setProgress([]);
    try {
      const found = (await call({ step: 'discover', token: secret })) as {
        sources: Array<{ key: string; id: string; label: string; props: string[] }>;
        currency: string | null;
      };
      const list: Progress[] = found.sources.map((db) => ({ key: db.key, label: db.label, count: 0, done: false }));
      setProgress(list);
      const seen: Record<string, string[]> = { expenses: [], incomes: [] };
      const partial: string[] = [];
      for (const [i, db] of found.sources.entries()) {
        setMessage(`Importing ${db.label.toLowerCase()}…`);
        let cursor: string | null = null;
        do {
          const res = (await call({ step: 'page', token: secret, key: db.key, sourceId: db.id, cursor, props: db.props })) as {
            next: string | null;
            count: number;
            ids: string[];
            incomplete: boolean;
          };
          list[i] = { ...list[i], count: list[i].count + res.count };
          if (db.key in seen) seen[db.key].push(...res.ids);
          if (res.incomplete && !partial.includes(db.label)) partial.push(db.label);
          cursor = res.next;
          setProgress([...list]);
        } while (cursor);
        list[i] = { ...list[i], done: true };
        setProgress([...list]);
      }
      // A partial listing says nothing about what was deleted in Notion, so skip the clean-up for it.
      for (const db of found.sources) if (partial.includes(db.label)) delete seen[db.key];
      const fin = (await call({ step: 'finish', seen, currency: found.currency })) as { removed: number };
      setMessage('Downloading to this device…');
      await sync();
      setMessage(
        partial.length
          ? `Imported, but Notion did not return every row for: ${partial.join(', ')}. Check that the integration can read content, then import again.`
          : fin.removed
            ? `Done. ${fin.removed} row(s) that are no longer in Notion were removed.`
            : 'Done. Everything from Notion is here.',
      );
      setPhase('done');
      setToken('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed.');
      setPhase('error');
    }
  };

  return (
    <Sheet
      title="Import from Notion"
      onSubmit={phase === 'running' ? undefined : phase === 'done' ? () => go('/', { replace: true }) : run}
      footer={
        <div className="btn-row">
          <button type="submit" className="btn primary grow" disabled={phase === 'running' || (phase !== 'done' && !token.trim())}>
            {phase === 'running' ? 'Importing…' : phase === 'done' ? 'Go to Today' : phase === 'error' ? 'Try again' : 'Import'}
          </button>
        </div>
      }
    >
      {phase === 'idle' || phase === 'error' ? (
        <>
          <ol className="steps">
            <li>
              In Notion, open <strong>Settings › Connections › Develop or manage integrations</strong> and create a new{' '}
              <strong>internal</strong> integration. Read access is enough. Copy its secret.
            </li>
            <li>
              Open your <strong>My Finance</strong> page, tap <strong>•••</strong> › <strong>Connections</strong>, and
              add that integration. Connect only this page, not older copies.
            </li>
            <li>Paste the secret below.</li>
          </ol>
          <div className="field">
            <label className="field-label" htmlFor="notion-token">
              Integration secret
            </label>
            <input
              id="notion-token"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="ntn_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div className="field-hint">
              Used only for this import to read from Notion. It is not stored anywhere, and nothing in Notion is changed.
            </div>
          </div>
        </>
      ) : null}
      {message ? <p className={phase === 'error' ? 'form-error' : 'lead'}>{message}</p> : null}
      {progress.length ? (
        <div className="rows">
          {progress.map((p) => (
            <div key={p.key} className="row static">
              <span>{p.label}</span>
              <span className="num">
                {p.count} {p.done ? '✓' : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------- Help ---------- */

const HOW: Array<{ what: string; where: string; how: string }> = [
  { what: 'Everyday spending', where: 'Expense', how: 'Pick the category that fits and what you paid with.' },
  {
    what: 'Split bill (I paid for others too)',
    where: 'Expense',
    how: 'Under More options set My share to your part (blank = all yours, 0 = all for others). Owed shows what is still to come back.',
  },
  {
    what: 'Someone pays me back',
    where: 'Repaid',
    how: 'Pick the bill it is for and where the money landed (it can differ from what you paid with). One bill per entry.',
  },
  {
    what: 'Merchant refund',
    where: 'Repaid',
    how: 'Pick the purchase and the card or bank refunded. The refund lowers that purchase’s cost, in the purchase’s month.',
  },
  {
    what: 'Yearly or big one-off cost',
    where: 'Expense',
    how: 'Under More options set Spread to 12 (or any number of months). Spent counts 1/N each month, starting in the purchase month.',
  },
  {
    what: 'Buy investments',
    where: 'Expense',
    how: 'Use the Investment category, pay from the bank, and set Target asset to the investment account.',
  },
  { what: 'Investment proceeds', where: 'Income', how: 'Use the Investment income category. If you sold a holding, set Source asset under More options.' },
  {
    what: 'Move money between my own accounts',
    where: 'Transfer',
    how: 'From = where it came from, To = where it went. Not counted as income.',
  },
  {
    what: 'Pay a credit card',
    where: 'Pay card',
    how: 'Card = the card, From = the bank. Neither income nor spending: it only moves balances.',
  },
  { what: 'Salary, bonus, other income', where: 'Income', how: 'Pick the category and the bank it landed in.' },
  { what: 'Saving', where: 'Nothing to log', how: 'Saved = Received − Spent, checked against your savings target.' },
];

export function HelpPage() {
  return (
    <>
      <Card>
        <SectionHead title="How I log things" />
        <div className="how">
          {HOW.map((h) => (
            <div key={h.what}>
              <div className="how-head">
                <strong>{h.what}</strong>
                <span className="tag">{h.where}</span>
              </div>
              <p>{h.how}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <SectionHead title="How the plan card reads" />
        <ul className="plain">
          <li>
            <strong>① Income</strong> is Received against the income target, and <strong>② Spending</strong> is Spent
            against the spending budget, for the month.
          </li>
          <li>
            <strong>③ Budget left</strong> = spending budget − Spent.
          </li>
          <li>
            <strong>④ Saved</strong> = Received − Spent, compared with the savings target.
          </li>
          <li>
            <strong>⑤ Unallocated</strong> = income target − spending budget − savings target: money you have not
            planned for yet.
          </li>
          <li>Spent uses your cost: your share of each bill, minus any refund, spread over its months.</li>
        </ul>
      </Card>
      <Card>
        <SectionHead title="Good to know" />
        <ul className="plain">
          <li>
            <strong>Don’t include</strong> keeps a row out of Spent and Received. It still moves account balances.
          </li>
          <li>Rows without a category are left out of Spent and Received. The ⚠️ Fix tab on Today lists them.</li>
          <li>Future-dated rows only count once their date arrives.</li>
          <li>New expenses start in the first expense category. Change it if it is something else.</li>
          <li>Months follow this device’s clock, so an entry just after midnight on the 1st belongs to the new month.</li>
          <li>The app works offline. Entries are saved on the device and sent when you are back online.</li>
        </ul>
      </Card>
    </>
  );
}
