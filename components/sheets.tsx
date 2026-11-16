'use client';

import { useState } from 'react';
import { useDerived } from '@/lib/derive';
import { byName, parseAmount } from '@/lib/finance';
import { displayName, money } from '@/lib/format';
import { closeSheet, toast, type SheetSpec } from '@/lib/nav';
import type {
  Account,
  AccountType,
  AssetCategory,
  AssetKind,
  ExpenseCategory,
  IncomeCategory,
  IncomeType,
  PaymentMethod,
  PaymentType,
  Recurring,
  Todo,
  TodoStatus,
} from '@/lib/schema';
import { discardPending, newId, put, remove, resetAndResync, sync, useStore } from '@/lib/store';
import { Chips, Field, Sheet, Switch, TextInput, confirmDelete } from './ui';

type Of<T extends SheetSpec['type']> = Extract<SheetSpec, { type: T }>;

function Footer({ onDelete, error }: { onDelete?: () => void; error?: string | null }) {
  return (
    <>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="btn-row">
        {onDelete ? (
          <button type="button" className="btn danger" onClick={onDelete}>
            Delete
          </button>
        ) : null}
        <button type="submit" className="btn primary grow">
          Save
        </button>
      </div>
    </>
  );
}

const saved = (what = 'Saved') => {
  toast(what);
  closeSheet();
};

/* ---------- Account ---------- */

const KIND_LABEL: Record<AssetKind, string> = {
  liquid: 'Liquid',
  investment: 'Investment',
  physical: 'Physical',
  other: 'Other',
  short: 'Short term',
  medium: 'Medium term',
  long: 'Long term',
};

export function AccountSheet({ spec }: { spec: Of<'account'> }) {
  const d = useDerived();
  const { tables } = useStore();
  const existing: Account | undefined = spec.id ? tables.accounts[spec.id] : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? spec.accountType ?? 'asset');
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? spec.categoryId ?? null);
  const [initial, setInitial] = useState(existing ? String(existing.initialValue) : '');
  const [purchased, setPurchased] = useState(existing?.purchasedDate ?? '');
  const [inNetWorth, setInNetWorth] = useState(existing?.inNetWorth ?? true);
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [error, setError] = useState<string | null>(null);
  const categories = byName(d.data.assetCategories.filter((c) => c.type === type));
  const used =
    !!existing &&
    (d.data.paymentMethods.some((p) => p.accountId === existing.id) ||
      d.data.expenses.some((e) => e.targetAccountId === existing.id) ||
      d.data.incomes.some((i) => i.sourceAccountId === existing.id));

  const save = () => {
    if (!name.trim()) return setError('Give the account a name.');
    const value = initial.trim() === '' ? 0 : parseAmount(initial);
    if (value === null) return setError('Opening balance must be a number.');
    put('accounts', {
      id: existing?.id ?? newId(),
      name: name.trim(),
      type,
      categoryId: categories.some((c) => c.id === categoryId) ? categoryId : null,
      initialValue: value,
      purchasedDate: purchased || null,
      inNetWorth,
      archived,
    });
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit account' : `New ${type === 'asset' ? 'asset' : 'liability'}`}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing && !used
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('accounts', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} />
      <Field label="Type">
        <Chips
          options={[
            { value: 'asset', label: 'Asset' },
            { value: 'liability', label: 'Liability' },
          ]}
          value={type}
          onChange={(v) => v && setType(v)}
        />
      </Field>
      <Field label="Category">
        {categories.length ? (
          <Chips
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
            allowNone
          />
        ) : (
          <div className="field-hint">No categories for this type yet. Add one under More › Accounts.</div>
        )}
      </Field>
      <TextInput
        label="Opening balance"
        inputMode="text"
        placeholder="0.00"
        value={initial}
        onChange={(e) => setInitial(e.target.value)}
        hint={
          type === 'liability'
            ? 'What the balance was when you started tracking. Enter a negative number if you owed money.'
            : 'What it was worth when you started tracking. Transactions move it from there.'
        }
      />
      <TextInput label="Since (optional)" type="date" value={purchased} onChange={(e) => setPurchased(e.target.value)} />
      <Switch label="Count in net worth" checked={inNetWorth} onChange={setInNetWorth} />
      {existing ? (
        <Switch
          label="Archived"
          hint={used ? 'Hides it from lists. It has transactions, so it cannot be deleted.' : 'Hides it from lists.'}
          checked={archived}
          onChange={setArchived}
        />
      ) : null}
    </Sheet>
  );
}

export function AssetCategorySheet({ spec }: { spec: Of<'assetCategory'> }) {
  const d = useDerived();
  const { tables } = useStore();
  const existing: AssetCategory | undefined = spec.id ? tables.assetCategories[spec.id] : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? spec.accountType ?? 'asset');
  const [kind, setKind] = useState<AssetKind>(existing?.kind ?? (type === 'asset' ? 'liquid' : 'short'));
  const [error, setError] = useState<string | null>(null);
  const kinds: AssetKind[] = type === 'asset' ? ['liquid', 'investment', 'physical', 'other'] : ['short', 'medium', 'long'];
  const used = !!existing && d.data.accounts.some((a) => a.categoryId === existing.id);

  const save = () => {
    if (!name.trim()) return setError('Give the category a name.');
    put('assetCategories', {
      id: existing?.id ?? newId(),
      name: name.trim(),
      type,
      kind: kinds.includes(kind) ? kind : kinds[0],
    });
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit account category' : 'New account category'}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing && !used
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('assetCategories', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} />
      <Field label="For">
        <Chips
          options={[
            { value: 'asset', label: 'Assets' },
            { value: 'liability', label: 'Liabilities' },
          ]}
          value={type}
          onChange={(v) => {
            if (!v) return;
            setType(v);
            setKind(v === 'asset' ? 'liquid' : 'short');
          }}
        />
      </Field>
      <Field label="Kind" hint="Used by the financial checkup (liquidity, investment and debt ratios).">
        <Chips
          options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          value={kind}
          onChange={(v) => v && setKind(v)}
        />
      </Field>
      {used ? <p className="note">Accounts use this category, so it cannot be deleted.</p> : null}
    </Sheet>
  );
}

/* ---------- Payment method ---------- */

const PAYMENT_LABEL: Record<PaymentType, string> = {
  bank: 'Bank account',
  ewallet: 'E-wallet',
  card: 'Credit card',
  cash: 'Cash',
};

export function PaymentMethodSheet({ spec }: { spec: Of<'paymentMethod'> }) {
  const d = useDerived();
  const { tables } = useStore();
  const existing: PaymentMethod | undefined = spec.id ? tables.paymentMethods[spec.id] : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<PaymentType>(existing?.type ?? 'bank');
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? null);
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [error, setError] = useState<string | null>(null);
  const accounts = byName(d.data.accounts.filter((a) => !a.archived || a.id === accountId));
  const used =
    !!existing &&
    (d.data.expenses.some((e) => e.paymentMethodId === existing.id) ||
      d.data.incomes.some((i) => i.paymentMethodId === existing.id));

  const save = () => {
    if (!name.trim()) return setError('Give the payment method a name.');
    if (!accountId) return setError('Link it to the account whose balance it moves.');
    put('paymentMethods', { id: existing?.id ?? newId(), name: name.trim(), type, accountId, archived });
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit payment method' : 'New payment method'}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing && !used
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('paymentMethods', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} />
      <Field label="Type">
        <Chips
          options={(Object.keys(PAYMENT_LABEL) as PaymentType[]).map((t) => ({ value: t, label: PAYMENT_LABEL[t] }))}
          value={type}
          onChange={(v) => v && setType(v)}
        />
      </Field>
      <Field
        label="Linked account"
        hint="Spending with this method lowers the account's balance; money received raises it. A credit card links to its card liability."
      >
        {accounts.length ? (
          <Chips
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            value={accountId}
            onChange={setAccountId}
          />
        ) : (
          <div className="field-hint">Add an account first, under Accounts.</div>
        )}
      </Field>
      {existing ? (
        <Switch
          label="Archived"
          hint={used ? 'Hides it when logging. It has transactions, so it cannot be deleted.' : 'Hides it when logging.'}
          checked={archived}
          onChange={setArchived}
        />
      ) : null}
    </Sheet>
  );
}

/* ---------- Categories ---------- */

export function ExpenseCategorySheet({ spec }: { spec: Of<'expenseCategory'> }) {
  const d = useDerived();
  const { tables } = useStore();
  const existing: ExpenseCategory | undefined = spec.id ? tables.expenseCategories[spec.id] : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [limit, setLimit] = useState(existing ? String(existing.budgetLimit) : '');
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [error, setError] = useState<string | null>(null);
  const used = !!existing && d.data.expenses.some((e) => e.categoryId === existing.id);

  const save = () => {
    if (!name.trim()) return setError('Give the category a name.');
    const value = limit.trim() === '' ? 0 : parseAmount(limit);
    if (value === null || value < 0) return setError('Limit must be a number.');
    put('expenseCategories', { id: existing?.id ?? newId(), name: name.trim(), budgetLimit: value, archived });
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit expense category' : 'New expense category'}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing && !used
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('expenseCategories', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <TextInput
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus={!existing}
        hint='A leading number sets the order, e.g. "3 | Bills & Utilities". The first category is the default for new expenses.'
      />
      <TextInput
        label="Monthly limit"
        inputMode="decimal"
        placeholder="0.00"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        hint="Limits add up to the spending budget."
      />
      {existing ? (
        <Switch
          label="Archived"
          hint={used ? 'Hides it when logging and drops its limit from the budget.' : 'Hides it when logging.'}
          checked={archived}
          onChange={setArchived}
        />
      ) : null}
    </Sheet>
  );
}

const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  income: 'Income',
  transfer: 'Transfer',
  card_payment: 'Card payment',
  reimbursement: 'Reimbursement',
};

export function IncomeCategorySheet({ spec }: { spec: Of<'incomeCategory'> }) {
  const d = useDerived();
  const { tables } = useStore();
  const existing: IncomeCategory | undefined = spec.id ? tables.incomeCategories[spec.id] : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<IncomeType>(existing?.type ?? 'income');
  const [target, setTarget] = useState(existing ? String(existing.target) : '');
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [error, setError] = useState<string | null>(null);
  const used = !!existing && d.data.incomes.some((i) => i.categoryId === existing.id);

  const save = () => {
    if (!name.trim()) return setError('Give the category a name.');
    const value = target.trim() === '' ? 0 : parseAmount(target);
    if (value === null || value < 0) return setError('Target must be a number.');
    put('incomeCategories', {
      id: existing?.id ?? newId(),
      name: name.trim(),
      type,
      target: type === 'income' ? value : 0,
      archived,
    });
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit income category' : 'New income category'}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing && !used
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('incomeCategories', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} />
      <Field
        label="Type"
        hint="Only Income counts toward Received. Transfers, card payments and reimbursements just move balances."
      >
        <Chips
          options={(Object.keys(INCOME_TYPE_LABEL) as IncomeType[]).map((t) => ({
            value: t,
            label: INCOME_TYPE_LABEL[t],
          }))}
          value={type}
          onChange={(v) => v && setType(v)}
        />
      </Field>
      {type === 'income' ? (
        <TextInput
          label="Monthly target"
          inputMode="decimal"
          placeholder="0.00"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          hint="Targets add up to the income target."
        />
      ) : null}
      {existing ? <Switch label="Archived" hint="Hides it when logging." checked={archived} onChange={setArchived} /> : null}
    </Sheet>
  );
}

/* ---------- To do ---------- */

export function TodoSheet({ spec }: { spec: Of<'todo'> }) {
  const { tables } = useStore();
  const existing: Todo | undefined = spec.id ? tables.todos[spec.id] : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [status, setStatus] = useState<TodoStatus>(existing?.status ?? 'not_started');
  const [tag, setTag] = useState<Todo['tag']>(existing?.tag ?? 'task');
  const [due, setDue] = useState(existing?.dueDate ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) return setError('What needs doing?');
    put('todos', {
      id: existing?.id ?? newId(),
      name: name.trim(),
      status,
      tag,
      dueDate: due || null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit to-do' : 'New to-do'}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('todos', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <TextInput label="To do" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} />
      <Field label="Status">
        <Chips
          options={[
            { value: 'not_started', label: 'Not started' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'done', label: 'Done' },
          ]}
          value={status}
          onChange={(v) => v && setStatus(v)}
        />
      </Field>
      <Field label="Tag">
        <Chips
          options={[
            { value: 'task', label: 'Task' },
            { value: 'reminder', label: 'Reminder' },
          ]}
          value={tag}
          onChange={(v) => v && setTag(v)}
        />
      </Field>
      <TextInput label="Due date (optional)" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
    </Sheet>
  );
}

/* ---------- Recurring ---------- */

export function RecurringSheet({ spec }: { spec: Of<'recurring'> }) {
  const d = useDerived();
  const { tables } = useStore();
  const existing: Recurring | undefined = spec.id ? tables.recurring[spec.id] : undefined;
  const [kind, setKind] = useState<Recurring['kind']>(existing?.kind ?? 'expense');
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(existing?.paymentMethodId ?? null);
  const [day, setDay] = useState(String(existing?.dayOfMonth ?? d.now.getDate()));
  const [active, setActive] = useState(existing?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const categories =
    kind === 'expense'
      ? byName(d.data.expenseCategories.filter((c) => !c.archived))
      : byName(d.data.incomeCategories.filter((c) => !c.archived && c.type === 'income'));
  const methods = byName(d.data.paymentMethods.filter((p) => !p.archived));

  const save = () => {
    const value = parseAmount(amount);
    const dom = Number(day);
    if (!name.trim()) return setError('Give it a name, e.g. spotify.');
    if (value === null || value <= 0) return setError('Enter an amount.');
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) return setError('Day must be between 1 and 31.');
    if (!categoryId || !paymentMethodId) return setError('Choose a category and an account.');
    put('recurring', {
      id: existing?.id ?? newId(),
      kind,
      name: name.trim(),
      amount: value,
      categoryId,
      paymentMethodId,
      dayOfMonth: dom,
      active,
      lastRun: existing?.lastRun ?? null,
    });
    void sync();
    saved();
  };

  return (
    <Sheet
      title={existing ? 'Edit recurring entry' : 'New recurring entry'}
      onSubmit={save}
      footer={
        <Footer
          error={error}
          onDelete={
            existing
              ? () => {
                  if (!confirmDelete(`"${existing.name}"`)) return;
                  remove('recurring', existing.id);
                  saved('Deleted');
                }
              : undefined
          }
        />
      }
    >
      <Field label="Kind">
        <Chips
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
          value={kind}
          onChange={(v) => {
            if (!v || v === kind) return;
            setKind(v);
            setCategoryId(null);
          }}
        />
      </Field>
      <TextInput label="Name" placeholder="e.g. spotify" value={name} onChange={(e) => setName(e.target.value)} />
      <TextInput
        label="Amount"
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Field label="Category">
        <Chips
          options={categories.map((c) => ({ value: c.id, label: displayName(c.name) }))}
          value={categoryId}
          onChange={setCategoryId}
        />
      </Field>
      <Field label={kind === 'expense' ? 'Paid with' : 'Received in'}>
        <Chips
          options={methods.map((p) => ({ value: p.id, label: p.name }))}
          value={paymentMethodId}
          onChange={setPaymentMethodId}
        />
      </Field>
      <TextInput
        label="Day of month"
        inputMode="numeric"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        hint="An entry is added automatically each month once this day arrives (the last day is used in shorter months)."
      />
      <Switch label="Active" checked={active} onChange={setActive} />
      {existing?.lastRun ? <p className="note">Last added for {existing.lastRun}.</p> : null}
    </Sheet>
  );
}

/* ---------- Sync status ---------- */

export function SyncSheet() {
  const s = useStore();
  const d = useDerived();
  const [busy, setBusy] = useState(false);
  const status = s.stuck
    ? 'The server refused some changes.'
    : !s.online
      ? 'Offline. Changes are saved on this device and sent when you are back online.'
      : s.error
        ? s.error
        : s.syncing
          ? 'Syncing…'
          : 'Everything is up to date.';
  return (
    <Sheet title="Sync">
      <p className="lead">{status}</p>
      <dl className="facts">
        <div>
          <dt>Waiting to send</dt>
          <dd>{s.outbox.length}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd>{s.lastSync ? new Date(s.lastSync).toLocaleString('en-GB') : 'never'}</dd>
        </div>
        <div>
          <dt>Expenses</dt>
          <dd>{d.data.expenses.length}</dd>
        </div>
        <div>
          <dt>Income rows</dt>
          <dd>{d.data.incomes.length}</dd>
        </div>
      </dl>
      <div className="stack">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await sync();
            setBusy(false);
          }}
        >
          Sync now
        </button>
        {s.stuck ? (
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (window.confirm(`Discard ${s.outbox.length} unsent change(s)? They will be lost.`)) void discardPending();
            }}
          >
            Discard unsent changes
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={busy || s.outbox.length > 0}
          onClick={async () => {
            setBusy(true);
            await resetAndResync();
            setBusy(false);
            toast('Reloaded from server');
          }}
        >
          Reload everything from the server
        </button>
      </div>
      <p className="note">
        Your data is kept on this device so the app opens instantly, and on the server so it is backed up and shared
        between your devices. Net worth right now: {money(d.netWorth.netWorth, d.currency)}.
      </p>
    </Sheet>
  );
}
