'use client';

import { useState, type ReactNode } from 'react';
import type { Derived } from '@/lib/derive';
import { expenseIssues, incomeIssues, type ExpenseInfo, type IncomeInfo, type Plan } from '@/lib/finance';
import { dayLabel, dayOf, displayName, money, monthLabel } from '@/lib/format';
import { openSheet } from '@/lib/nav';
import { Bar, Empty, Icon, Money } from './ui';

export type TxItem = { kind: 'expense'; info: ExpenseInfo } | { kind: 'income'; info: IncomeInfo };

export const asItems = (expenses: ExpenseInfo[], incomes: IncomeInfo[]): TxItem[] =>
  [
    ...expenses.map((info) => ({ kind: 'expense' as const, info })),
    ...incomes.map((info) => ({ kind: 'income' as const, info })),
  ].sort((a, b) => b.info.time - a.info.time);

const itemId = (item: TxItem) => (item.kind === 'expense' ? item.info.expense.id : item.info.income.id);

export function openItem(item: TxItem) {
  if (item.kind === 'expense') openSheet({ type: 'entry', mode: 'expense', id: item.info.expense.id });
  else openSheet({ type: 'entry', mode: item.info.type ?? 'income', id: item.info.income.id });
}

export function TxRow({ item, d, showIssues }: { item: TxItem; d: Derived; showIssues?: boolean }) {
  const { ix, currency } = d;
  const tags: ReactNode[] = [];
  let sub: string[];
  let amount: ReactNode;
  let name: string;
  let excluded: boolean;

  if (item.kind === 'expense') {
    const { expense } = item.info;
    name = expense.name;
    excluded = expense.exclude;
    const cat = expense.categoryId ? ix.expenseCategoryById.get(expense.categoryId) : undefined;
    const pm = expense.paymentMethodId ? ix.paymentMethodById.get(expense.paymentMethodId) : undefined;
    const target = expense.targetAccountId ? ix.accountById.get(expense.targetAccountId) : undefined;
    sub = [cat ? displayName(cat.name) : 'No category', pm?.name ?? '', target ? `→ ${target.name}` : ''];
    if (expense.myShare != null) {
      tags.push(
        <span key="split" className={`tag ${item.info.owed > 0.004 ? 'warn' : ''}`}>
          {item.info.owed > 0.004 ? `owed ${money(item.info.owed, currency)}` : 'settled'}
        </span>,
      );
    }
    if (item.info.months > 1) tags.push(<span key="spread" className="tag">over {item.info.months} mo</span>);
    if (showIssues) {
      for (const issue of expenseIssues(ix, item.info)) {
        tags.push(<span key={issue} className="tag bad">{issue}</span>);
      }
    }
    amount = <Money value={expense.amount} currency={currency} tone={excluded ? 'muted' : undefined} />;
  } else {
    const { income } = item.info;
    name = income.name;
    excluded = income.exclude;
    const cat = income.categoryId ? ix.incomeCategoryById.get(income.categoryId) : undefined;
    const pm = income.paymentMethodId ? ix.paymentMethodById.get(income.paymentMethodId) : undefined;
    const source = income.sourceAccountId ? ix.accountById.get(income.sourceAccountId) : undefined;
    const bill = income.expenseId ? ix.expenseById.get(income.expenseId) : undefined;
    sub = [
      cat ? displayName(cat.name) : 'No category',
      source ? `${source.name} → ${pm?.name ?? '?'}` : (pm?.name ?? ''),
      bill ? `for ${bill.expense.name}` : '',
    ];
    if (showIssues) {
      for (const issue of incomeIssues(ix, item.info)) {
        tags.push(<span key={issue} className="tag bad">{issue}</span>);
      }
    }
    const counted = item.info.type === 'income' && !excluded;
    amount = <Money value={income.amount} currency={currency} tone={counted ? 'pos' : 'muted'} plus />;
  }
  if (excluded) tags.push(<span key="x" className="tag">not counted</span>);

  return (
    <button type="button" className={`tx ${excluded ? 'dim' : ''}`} onClick={() => openItem(item)}>
      <span className={`tx-icon ${item.kind}`}>
        <Icon name={item.kind === 'expense' ? 'up' : 'down'} size={16} />
      </span>
      <span className="tx-main">
        <span className="tx-name">{name || 'Untitled'}</span>
        <span className="tx-sub">{sub.filter(Boolean).join(' · ')}</span>
        {tags.length ? <span className="tx-tags">{tags}</span> : null}
      </span>
      <span className="tx-amount">{amount}</span>
    </button>
  );
}

const PAGE = 60;

/** Transactions grouped by day, newest first, with a per-day spending total. */
export function TxList({
  items,
  d,
  empty,
  showIssues,
}: {
  items: TxItem[];
  d: Derived;
  empty: string;
  showIssues?: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  if (!items.length) return <Empty>{empty}</Empty>;
  const shown = items.slice(0, limit);
  const groups: Array<{ day: number; items: TxItem[]; spent: number }> = [];
  for (const item of shown) {
    const day = dayOf(item.info.time);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, items: [], spent: 0 };
      groups.push(g);
    }
    g.items.push(item);
    if (item.kind === 'expense' && !item.info.expense.exclude) g.spent += item.info.expense.amount;
  }
  return (
    <div className="tx-list">
      {groups.map((g) => (
        <div key={g.day} className="tx-group">
          <div className="tx-day">
            <span>{dayLabel(g.day, d.now)}</span>
            {g.spent > 0 ? <span className="num">{money(g.spent, d.currency)}</span> : null}
          </div>
          {g.items.map((item) => (
            <TxRow key={item.kind + itemId(item)} item={item} d={d} showIssues={showIssues} />
          ))}
        </div>
      ))}
      {items.length > limit ? (
        <button type="button" className="btn block" onClick={() => setLimit(limit + PAGE * 3)}>
          Show more ({items.length - limit} left)
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Plan card ---------- */

export function PlanCard({ plan, currency }: { plan: Plan; currency: string }) {
  const saveGap = plan.savingsTarget - plan.saved;
  return (
    <div className="plan">
      <div className="plan-row">
        <div className="plan-line">
          <span className="plan-label">① Income</span>
          <span className="num">
            <strong>{money(plan.received, currency)}</strong>
            <small> of {money(plan.incomeTarget, currency)}</small>
          </span>
        </div>
        <Bar value={plan.received} max={plan.incomeTarget} />
      </div>
      <div className="plan-row">
        <div className="plan-line">
          <span className="plan-label">② Spending</span>
          <span className="num">
            <strong>{money(plan.spent, currency)}</strong>
            <small> of {money(plan.spendingBudget, currency)}</small>
          </span>
        </div>
        <Bar value={plan.spent} max={plan.spendingBudget} tone="spend" />
      </div>
      <div className="plan-stats">
        <div>
          <span className="plan-label">③ Budget left</span>
          <Money value={plan.budgetLeft} currency={currency} tone="auto" />
        </div>
        <div>
          <span className="plan-label">④ Saved</span>
          <Money value={plan.saved} currency={currency} tone="auto" />
          <small>
            {plan.savingsTarget > 0
              ? saveGap <= 0
                ? `target ${money(plan.savingsTarget, currency)} met`
                : `${money(saveGap, currency)} to target`
              : 'no target set'}
          </small>
        </div>
        <div>
          <span className="plan-label">⑤ Unallocated</span>
          <Money value={plan.unallocated} currency={currency} tone="auto" />
          <small>{Math.abs(plan.unallocated) < 0.005 ? 'every dollar has a job' : 'aim for 0'}</small>
        </div>
      </div>
    </div>
  );
}

export function MonthNav({ month, onChange, current }: { month: number; onChange: (m: number) => void; current: number }) {
  return (
    <div className="month-nav">
      <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => onChange(month - 1)}>
        <Icon name="left" />
      </button>
      <button type="button" className="month-label" onClick={() => onChange(current)} disabled={month === current}>
        {monthLabel(month)}
        {month === current ? null : <small>Back to this month</small>}
      </button>
      <button type="button" className="icon-btn" aria-label="Next month" onClick={() => onChange(month + 1)}>
        <Icon name="right" />
      </button>
    </div>
  );
}
