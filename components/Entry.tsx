'use client';

import { useMemo, useState } from 'react';
import { useDerived, type Derived } from '@/lib/derive';
import { byName, matchSuggestions, nameSuggestions, parseAmount } from '@/lib/finance';
import { dayLabel, dayOf, displayName, fromLocalInput, money, toLocalInput } from '@/lib/format';
import { closeSheet, openSheet, toast, type EntryMode, type SheetSpec } from '@/lib/nav';
import type { Expense, Income } from '@/lib/schema';
import { newId, put, remove, useStore } from '@/lib/store';
import { Chips, Field, Sheet, Switch, TextInput, confirmDelete } from './ui';

const MODES: Array<{ value: EntryMode; label: string; title: string }> = [
  { value: 'expense', label: 'Expense', title: 'expense' },
  { value: 'income', label: 'Income', title: 'income' },
  { value: 'transfer', label: 'Transfer', title: 'transfer' },
  { value: 'card_payment', label: 'Pay card', title: 'card payment' },
  { value: 'reimbursement', label: 'Repaid', title: 'repayment / refund' },
];

/* Remember the last account used per kind of entry, on this device. */
type Last = { paymentMethodId?: string | null; sourceAccountId?: string | null };
function readLast(mode: EntryMode): Last {
  try {
    return JSON.parse(localStorage.getItem(`mf.last.${mode}`) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function writeLast(mode: EntryMode, last: Last) {
  try {
    localStorage.setItem(`mf.last.${mode}`, JSON.stringify(last));
  } catch {
    /* ignore */
  }
}

const fmtInput = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** The value used most often among the newest rows: a sensible default on a device with no history of its own. */
function mostUsed(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values.slice(0, 60)) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function defaultsFor(mode: EntryMode, d: Derived) {
  const last = readLast(mode);
  const pms = byName(d.data.paymentMethods.filter((p) => !p.archived));
  const candidates = mode === 'card_payment' ? pms.filter((p) => p.type === 'card') : pms;
  const known = (id?: string | null) => (id && candidates.some((p) => p.id === id) ? id : null);
  // Newest first, so "most used" reflects current habits.
  const recent =
    mode === 'expense'
      ? d.expenses.map((e) => e.expense.paymentMethodId)
      : d.incomes.filter((i) => i.type === mode).map((i) => i.income.paymentMethodId);
  const fallback =
    mode === 'expense' || mode === 'card_payment'
      ? candidates[0]
      : (candidates.find((p) => p.type !== 'card') ?? candidates[0]);
  const paymentMethodId = known(last.paymentMethodId) ?? known(mostUsed(recent)) ?? fallback?.id ?? null;
  const categories =
    mode === 'expense'
      ? byName(d.data.expenseCategories.filter((c) => !c.archived))
      : byName(d.data.incomeCategories.filter((c) => !c.archived && c.type === mode));
  const accounts = d.data.accounts.filter((a) => !a.archived && a.type === 'asset');
  const usual = mostUsed(d.incomes.filter((i) => i.type === mode).map((i) => i.income.sourceAccountId));
  const remembered = accounts.find((a) => a.id === (last.sourceAccountId ?? usual))?.id ?? null;
  // Card payments nearly always come from the same bank; transfers vary, so those start blank.
  const sourceAccountId = mode === 'card_payment' ? remembered : null;
  return { paymentMethodId, categoryId: categories[0]?.id ?? null, sourceAccountId };
}

export function EntrySheet({ spec }: { spec: Extract<SheetSpec, { type: 'entry' }> }) {
  const d = useDerived();
  const { tables } = useStore();
  const editingExpense: Expense | undefined = spec.mode === 'expense' && spec.id ? tables.expenses[spec.id] : undefined;
  const editingIncome: Income | undefined = spec.mode !== 'expense' && spec.id ? tables.incomes[spec.id] : undefined;
  const editing = editingExpense ?? editingIncome;

  const [mode, setMode] = useState<EntryMode>(spec.mode);
  const initial = useMemo(() => defaultsFor(spec.mode, d), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [amount, setAmount] = useState(fmtInput(editing?.amount ?? spec.preset?.amount));
  const [name, setName] = useState(editing?.name ?? spec.preset?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(
    editing ? editing.categoryId : (spec.preset?.categoryId ?? initial.categoryId),
  );
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(
    editing ? editing.paymentMethodId : (spec.preset?.paymentMethodId ?? initial.paymentMethodId),
  );
  const [when, setWhen] = useState(toLocalInput(editing ? new Date(editing.date) : new Date()));
  const [exclude, setExclude] = useState(editing?.exclude ?? false);
  // Expense-only
  const [myShare, setMyShare] = useState(fmtInput(editingExpense?.myShare));
  const [splitWith, setSplitWith] = useState(editingExpense?.splitWith ?? '');
  const [spread, setSpread] = useState(fmtInput(editingExpense?.spreadMonths));
  const [targetAccountId, setTargetAccountId] = useState<string | null>(editingExpense?.targetAccountId ?? null);
  // Income-only
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(
    editingIncome ? editingIncome.sourceAccountId : initial.sourceAccountId,
  );
  const [expenseId, setExpenseId] = useState<string | null>(editingIncome?.expenseId ?? spec.preset?.expenseId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [nameFocused, setNameFocused] = useState(false);

  const isExpense = mode === 'expense';
  const paymentMethods = useMemo(
    () => byName(d.data.paymentMethods.filter((p) => !p.archived || p.id === paymentMethodId)),
    [d.data.paymentMethods, paymentMethodId],
  );
  const categories = useMemo(
    () =>
      isExpense
        ? byName(d.data.expenseCategories.filter((c) => !c.archived || c.id === categoryId))
        : byName(d.data.incomeCategories.filter((c) => (!c.archived && c.type === mode) || c.id === categoryId)),
    [d.data.expenseCategories, d.data.incomeCategories, isExpense, mode, categoryId],
  );
  const accounts = useMemo(() => byName(d.data.accounts.filter((a) => !a.archived)), [d.data.accounts]);
  const assetAccounts = accounts.filter((a) => a.type === 'asset' || a.id === sourceAccountId);

  const suggestions = useMemo(() => {
    const all = isExpense ? d.suggestions : nameSuggestions(d.data.incomes);
    return matchSuggestions<Expense | Income>(all, name, 4);
  }, [isExpense, d.suggestions, d.data.incomes, name]);

  const switchMode = (next: EntryMode) => {
    if (next === mode) return;
    // An existing expense stays an expense, and an income row stays an income row.
    if (editing && (next === 'expense') !== isExpense) return;
    const def = defaultsFor(next, d);
    setMode(next);
    setCategoryId(def.categoryId);
    if (!editing) {
      setPaymentMethodId(def.paymentMethodId);
      setSourceAccountId(def.sourceAccountId);
    }
    setError(null);
  };

  const card = mode === 'card_payment' && paymentMethodId ? d.ix.paymentMethodById.get(paymentMethodId) : undefined;
  const cardOwed = card?.accountId ? -(d.balances.get(card.accountId)?.current ?? 0) : 0;
  const linked = expenseId ? d.ix.expenseById.get(expenseId) : undefined;
  const editingInfo = editingExpense ? d.ix.expenseById.get(editingExpense.id) : undefined;

  const save = (keepOpen: boolean) => {
    const value = parseAmount(amount);
    if (value === null || value <= 0) return setError('Enter an amount.');
    if (!paymentMethodId && paymentMethods.length) {
      return setError(isExpense ? 'Choose what you paid with.' : 'Choose where the money landed.');
    }
    const date = fromLocalInput(when) ?? new Date();
    const nowIso = new Date().toISOString();
    const pmName = paymentMethodId ? (d.ix.paymentMethodById.get(paymentMethodId)?.name ?? '') : '';
    const catName = categoryId
      ? displayName(
          (isExpense ? d.ix.expenseCategoryById.get(categoryId) : d.ix.incomeCategoryById.get(categoryId))?.name ?? '',
        )
      : '';
    let finalName = name.trim();

    if (isExpense) {
      const share = myShare.trim() === '' ? null : parseAmount(myShare);
      if (myShare.trim() !== '' && (share === null || share < 0 || share > value)) {
        return setError('My share must be between 0 and the amount.');
      }
      const months = spread.trim() === '' ? null : Number(spread);
      if (months !== null && (!Number.isInteger(months) || months < 1 || months > 600)) {
        return setError('Spread must be a whole number of months.');
      }
      const row: Expense = {
        id: editingExpense?.id ?? newId(),
        name: finalName || catName || 'Expense',
        amount: value,
        date: date.toISOString(),
        categoryId,
        paymentMethodId,
        targetAccountId,
        myShare: share,
        splitWith: splitWith.trim(),
        spreadMonths: months && months > 1 ? months : null,
        exclude,
        createdAt: editingExpense?.createdAt ?? nowIso,
        source: editingExpense?.source ?? 'app',
      };
      put('expenses', row);
    } else {
      if ((mode === 'transfer' || mode === 'card_payment') && !sourceAccountId) {
        return setError('Choose the account the money came from.');
      }
      if (!finalName) {
        const from = sourceAccountId ? (d.ix.accountById.get(sourceAccountId)?.name ?? '') : '';
        if (mode === 'transfer') finalName = `${from} → ${pmName}`.toLowerCase();
        else if (mode === 'card_payment') finalName = 'pay credit card';
        else if (mode === 'reimbursement') finalName = linked ? `${linked.expense.name} repaid` : 'repayment';
        else finalName = catName || 'Income';
      }
      const row: Income = {
        id: editingIncome?.id ?? newId(),
        name: finalName,
        amount: value,
        date: date.toISOString(),
        categoryId,
        paymentMethodId,
        sourceAccountId,
        expenseId: mode === 'reimbursement' ? expenseId : (editingIncome?.expenseId ?? null),
        exclude,
        createdAt: editingIncome?.createdAt ?? nowIso,
        source: editingIncome?.source ?? 'app',
      };
      put('incomes', row);
    }
    writeLast(mode, { paymentMethodId, sourceAccountId });
    toast(`${editing ? 'Updated' : 'Saved'} · ${money(value, d.currency)}`);
    if (keepOpen) {
      setAmount('');
      setName('');
      setMyShare('');
      setSplitWith('');
      setSpread('');
      setExpenseId(null);
      setError(null);
      setWhen(toLocalInput(new Date()));
      (document.getElementById('entry-amount') as HTMLInputElement | null)?.focus();
    } else {
      closeSheet();
    }
  };

  const del = () => {
    if (!editing || !confirmDelete(`"${editing.name}"`)) return;
    remove(isExpense ? 'expenses' : 'incomes', editing.id);
    toast('Deleted');
    closeSheet();
  };

  const modeInfo = MODES.find((m) => m.value === mode)!;
  const modeOptions = editing ? MODES.filter((m) => (m.value === 'expense') === isExpense) : MODES;
  const advancedOpen =
    !!editing && (exclude || myShare !== '' || spread !== '' || !!targetAccountId || (mode === 'income' && !!sourceAccountId));

  return (
    <Sheet
      title={`${editing ? 'Edit' : 'New'} ${modeInfo.title}`}
      onSubmit={() => save(false)}
      footer={
        <>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="btn-row">
            {editing ? (
              <button type="button" className="btn danger" onClick={del}>
                Delete
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => save(true)}>
                Save &amp; new
              </button>
            )}
            <button type="submit" className="btn primary grow">
              Save
            </button>
          </div>
        </>
      }
    >
      {modeOptions.length > 1 ? (
        <div className="segmented" role="tablist" aria-label="Kind of entry">
          {modeOptions.map((m) => (
            <button
              key={m.value}
              type="button"
              role="tab"
              aria-selected={m.value === mode}
              className={m.value === mode ? 'on' : ''}
              onClick={() => switchMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="amount-box">
        <span>{d.currency}</span>
        <input
          id="entry-amount"
          aria-label="Amount"
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          autoFocus={!editing}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const v = parseAmount(amount);
            if (v !== null && /[-+*/]/.test(amount.slice(1))) setAmount(String(v));
          }}
        />
      </div>

      {mode === 'card_payment' && cardOwed > 0.004 ? (
        <div className="hint-row">
          <span>
            Owed on {card?.name}: {money(cardOwed, d.currency)}
          </span>
          <button type="button" className="link" onClick={() => setAmount(String(cardOwed))}>
            Pay in full
          </button>
        </div>
      ) : null}

      {mode === 'reimbursement' ? (
        <ExpensePicker
          d={d}
          value={expenseId}
          onChange={(id) => {
            setExpenseId(id);
            const info = id ? d.ix.expenseById.get(id) : undefined;
            if (info && !amount.trim() && info.owed > 0) setAmount(String(info.owed));
          }}
        />
      ) : null}

      <div className="field suggest-wrap">
        <label className="field-label" htmlFor="entry-name">
          {mode === 'transfer' || mode === 'card_payment' || mode === 'reimbursement' ? 'Note (optional)' : 'Name'}
        </label>
        <input
          id="entry-name"
          className="input"
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="done"
          placeholder={isExpense ? 'e.g. lunch' : mode === 'income' ? 'e.g. salary' : ''}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setTimeout(() => setNameFocused(false), 150)}
        />
        {nameFocused && suggestions.length && (isExpense || mode === 'income') ? (
          <div className="suggest" role="listbox" aria-label="Past entries">
            {suggestions.map((s) => {
              const cat = s.last.categoryId
                ? (isExpense ? d.ix.expenseCategoryById : d.ix.incomeCategoryById).get(s.last.categoryId)
                : undefined;
              const pm = s.last.paymentMethodId ? d.ix.paymentMethodById.get(s.last.paymentMethodId) : undefined;
              return (
                <button
                  key={s.name}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setName(s.name);
                    if (cat && !cat.archived) setCategoryId(cat.id);
                    if (pm && !pm.archived) setPaymentMethodId(pm.id);
                    if (!amount.trim()) setAmount(String(s.last.amount));
                    setNameFocused(false);
                  }}
                >
                  <span>{s.name}</span>
                  <small>
                    {[cat && displayName(cat.name), pm?.name, money(s.last.amount, d.currency)].filter(Boolean).join(' · ')}
                  </small>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {categories.length > 1 || (isExpense && categories.length > 0) ? (
        <Field label="Category">
          <Chips
            options={categories.map((c) => ({ value: c.id, label: displayName(c.name) }))}
            value={categoryId}
            onChange={setCategoryId}
            allowNone={isExpense}
          />
        </Field>
      ) : null}

      {mode === 'transfer' || mode === 'card_payment' ? (
        <Field label="From">
          <Chips
            options={assetAccounts.map((a) => ({
              value: a.id,
              label: a.name,
              sub: money(d.balances.get(a.id)?.current ?? 0, d.currency),
            }))}
            value={sourceAccountId}
            onChange={setSourceAccountId}
          />
        </Field>
      ) : null}

      <Field
        label={
          isExpense ? 'Paid with' : mode === 'transfer' ? 'To' : mode === 'card_payment' ? 'Card' : 'Received in'
        }
      >
        {paymentMethods.length ? (
          <Chips
            options={(mode === 'card_payment'
              ? paymentMethods.filter((p) => p.type === 'card' || p.id === paymentMethodId)
              : paymentMethods
            ).map((p) => ({ value: p.id, label: p.name }))}
            value={paymentMethodId}
            onChange={(v) => v && setPaymentMethodId(v)}
          />
        ) : (
          <div className="field-hint">No payment methods yet. Add one under More › Accounts &amp; payment methods.</div>
        )}
      </Field>

      <div className="field">
        <label className="field-label" htmlFor="entry-when">
          When
        </label>
        <div className="when-row">
          <input
            id="entry-when"
            className="input"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const cur = fromLocalInput(when) ?? new Date();
              cur.setDate(cur.getDate() - 1);
              setWhen(toLocalInput(cur));
            }}
          >
            −1 day
          </button>
          <button type="button" className="btn small" onClick={() => setWhen(toLocalInput(new Date()))}>
            Now
          </button>
        </div>
      </div>

      {mode !== 'transfer' && mode !== 'card_payment' ? (
        <details className="more" open={advancedOpen || undefined}>
          <summary>More options</summary>
          <div className="more-body">
          <Switch
            label="Don't include"
            hint={isExpense ? 'Leave out of Spent. Balances still move.' : 'Leave out of Received. Balances still move.'}
            checked={exclude}
            onChange={setExclude}
          />
          {isExpense ? (
            <>
              <div className="two">
                <TextInput
                  label="My share"
                  inputMode="decimal"
                  placeholder="all mine"
                  value={myShare}
                  onChange={(e) => setMyShare(e.target.value)}
                  hint="Paid for others too? Your part (0 = all theirs)."
                />
                <TextInput
                  label="Split with"
                  placeholder="who"
                  value={splitWith}
                  onChange={(e) => setSplitWith(e.target.value)}
                />
              </div>
              <TextInput
                label="Spread (months)"
                inputMode="numeric"
                placeholder="1"
                value={spread}
                onChange={(e) => setSpread(e.target.value)}
                hint="Yearly or lump-sum cost: counts 1/N of it each month, starting this month."
              />
              <Field label="Adds value to (target asset)" hint="Buying investments or topping up another account.">
                <Chips
                  options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  value={targetAccountId}
                  onChange={setTargetAccountId}
                  allowNone
                />
              </Field>
              {editingInfo && editingExpense?.myShare != null ? (
                <div className="hint-row">
                  <span>
                    Their share {money(editingInfo.theirShare, d.currency)} · repaid{' '}
                    {money(editingInfo.repaid, d.currency)} · owed {money(editingInfo.owed, d.currency)}
                  </span>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      openSheet({ type: 'entry', mode: 'reimbursement', preset: { expenseId: editingExpense.id } })
                    }
                  >
                    Log repayment
                  </button>
                </div>
              ) : null}
            </>
          ) : mode === 'income' ? (
            <Field label="Takes value from (source asset)" hint="Selling something you hold, e.g. an investment.">
              <Chips
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                value={sourceAccountId}
                onChange={setSourceAccountId}
                allowNone
              />
            </Field>
          ) : null}
          </div>
        </details>
      ) : null}
    </Sheet>
  );
}

/** Choose the bill a repayment or refund is for. Bills that are still owed come first. */
function ExpensePicker({
  d,
  value,
  onChange,
}: {
  d: Derived;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = value ? d.ix.expenseById.get(value) : undefined;
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return d.expenses.filter((e) => e.expense.name.toLowerCase().includes(q)).slice(0, 8);
    const owed = d.owed.filter((e) => e.owed > 0.004).slice(0, 8);
    return owed.length ? owed : d.expenses.slice(0, 6);
  }, [d.expenses, d.owed, query]);

  if (selected) {
    return (
      <Field label="For expense">
        <div className="picked">
          <div>
            <strong>{selected.expense.name}</strong>
            <small>
              {dayLabel(dayOf(selected.time))} · {money(selected.expense.amount, d.currency)}
              {selected.expense.myShare != null ? ` · owed ${money(selected.owed, d.currency)}` : ''}
            </small>
          </div>
          <button type="button" className="link" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      </Field>
    );
  }
  return (
    <Field label="For expense" hint="The bill being repaid, or the purchase being refunded. One bill per entry.">
      <input
        className="input"
        placeholder="Search expenses"
        aria-label="Search expenses"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="pick-list">
        {options.map((e) => (
          <button key={e.expense.id} type="button" onClick={() => onChange(e.expense.id)}>
            <span>
              {e.expense.name}
              <small>
                {dayLabel(dayOf(e.time))}
                {e.expense.splitWith ? ` · ${e.expense.splitWith}` : ''}
              </small>
            </span>
            <span className="num">
              {e.owed > 0.004 ? `owed ${money(e.owed, d.currency)}` : money(e.expense.amount, d.currency)}
            </span>
          </button>
        ))}
        {!options.length ? <div className="field-hint">No matching expenses.</div> : null}
      </div>
    </Field>
  );
}
