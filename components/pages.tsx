'use client';

import { useMemo, useState } from 'react';
import { useDerived, type Derived } from '@/lib/derive';
import { byName, computePlan, nameSuggestions, type Balance, type CategoryTotal } from '@/lib/finance';
import { dateLabel, dayLabel, dayOf, displayName, money, percent, todayIso } from '@/lib/format';
import { go, openSheet, type EntryMode } from '@/lib/nav';
import { patch } from '@/lib/store';
import { MonthNav, PlanCard, TxList, TxRow, asItems, type TxItem } from './Tx';
import { Bar, Card, Empty, Icon, Money, SectionHead, Tabs } from './ui';

const WEEK = 7 * 86_400_000;

const QUICK: Array<{ mode: EntryMode; label: string; icon: string }> = [
  { mode: 'expense', label: 'Expense', icon: 'up' },
  { mode: 'income', label: 'Income', icon: 'down' },
  { mode: 'transfer', label: 'Transfer', icon: 'swap' },
  { mode: 'card_payment', label: 'Pay card', icon: 'card' },
  { mode: 'reimbursement', label: 'Repaid', icon: 'undo' },
];

/* ---------- Today ---------- */

export function TodayPage() {
  const d = useDerived();
  const [tab, setTab] = useState<'week' | 'owed' | 'fix' | 'moves'>('week');
  const since = d.now.getTime() - WEEK;

  const frequent = useMemo(
    () =>
      nameSuggestions(d.data.expenses, d.now.getTime() - 60 * 86_400_000)
        .filter((s) => s.count >= 2)
        .slice(0, 8),
    [d.data.expenses, d.now],
  );

  const week = useMemo(
    () =>
      asItems(
        d.expenses.filter((e) => e.time >= since),
        d.incomes.filter((i) => i.time >= since && (i.type === 'income' || i.type === null)),
      ),
    [d.expenses, d.incomes, since],
  );
  const moves = useMemo(
    () =>
      asItems(
        [],
        d.incomes.filter((i) => i.time >= since && i.type !== 'income' && i.type !== null),
      ),
    [d.incomes, since],
  );
  const owed = d.owed.filter((e) => e.owed > 0.004);
  const fixes: TxItem[] = useMemo(
    () =>
      d.fixes.flatMap((f): TxItem[] => {
        if (f.kind === 'expense') {
          const info = d.ix.expenseById.get(f.id);
          return info ? [{ kind: 'expense', info }] : [];
        }
        const info = d.ix.incomes.find((i) => i.income.id === f.id);
        return info ? [{ kind: 'income', info }] : [];
      }),
    [d.fixes, d.ix],
  );

  return (
    <>
      <Card>
        <SectionHead title="This month plan" />
        <PlanCard plan={d.plan} currency={d.currency} />
      </Card>

      <div className="quick" aria-label="Quick actions">
        {QUICK.map((q) => (
          <button key={q.mode} type="button" onClick={() => openSheet({ type: 'entry', mode: q.mode })}>
            <Icon name={q.icon} size={18} />
            {q.label}
          </button>
        ))}
      </div>

      {frequent.length ? (
        <div className="frequent" aria-label="Frequent expenses">
          {frequent.map((s) => (
            <button
              key={s.name}
              type="button"
              className="chip"
              onClick={() =>
                openSheet({
                  type: 'entry',
                  mode: 'expense',
                  preset: {
                    name: s.name,
                    amount: s.last.amount,
                    categoryId: s.last.categoryId,
                    paymentMethodId: s.last.paymentMethodId,
                  },
                })
              }
            >
              {s.name}
              <small>{money(s.last.amount, d.currency)}</small>
            </button>
          ))}
        </div>
      ) : null}

      <Card>
        <SectionHead title="Transactions" />
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'week', label: 'Past week' },
            { value: 'moves', label: 'Moves' },
            { value: 'owed', label: 'Owed to me', badge: owed.length },
            { value: 'fix', label: '⚠️ Fix', badge: fixes.length, alert: true },
          ]}
        />
        {tab === 'week' ? <TxList items={week} d={d} empty="Nothing logged in the past week." /> : null}
        {tab === 'moves' ? (
          <TxList items={moves} d={d} showIssues empty="No transfers, card payments or repayments this week." />
        ) : null}
        {tab === 'owed' ? (
          owed.length ? (
            <div className="tx-list">
              {owed.map((info) => (
                <TxRow key={info.expense.id} item={{ kind: 'expense', info }} d={d} />
              ))}
            </div>
          ) : (
            <Empty>Nobody owes you anything.</Empty>
          )
        ) : null}
        {tab === 'fix' ? (
          <TxList items={fixes} d={d} showIssues empty="Nothing to fix. Every row has what it needs." />
        ) : null}
      </Card>

      <NetWorthCard d={d} />
      <TodoCard d={d} />
    </>
  );
}

function NetWorthCard({ d }: { d: Derived }) {
  const shown = (b: Balance) => {
    const kind = b.account.categoryId ? d.ix.assetCategoryById.get(b.account.categoryId)?.kind : undefined;
    return !b.account.archived && (kind === 'liquid' || kind === 'investment' || kind === 'short' || !kind);
  };
  const list = [...d.balances.values()].filter(shown).sort((a, b) => b.current - a.current);
  const assets = list.filter((b) => b.account.type === 'asset');
  const debts = list.filter((b) => b.account.type === 'liability');
  return (
    <Card>
      <SectionHead
        title="Net worth & balances"
        action={
          <button type="button" className="link" onClick={() => go('/accounts', { replace: true })}>
            See all
          </button>
        }
      />
      <div className="networth">
        <div className="big">
          <Money value={d.netWorth.netWorth} currency={d.currency} tone="auto" />
        </div>
        <div className="networth-split">
          <span>
            Assets <Money value={d.netWorth.assets} currency={d.currency} />
          </span>
          <span>
            Liabilities <Money value={d.netWorth.liabilities} currency={d.currency} tone="auto" />
          </span>
        </div>
      </div>
      {list.length ? (
        <div className="rows">
          {assets.length ? <div className="rows-label">Assets</div> : null}
          {assets.map((b) => (
            <BalanceRow key={b.account.id} b={b} currency={d.currency} />
          ))}
          {debts.length ? <div className="rows-label">Liabilities</div> : null}
          {debts.map((b) => (
            <BalanceRow key={b.account.id} b={b} currency={d.currency} />
          ))}
        </div>
      ) : (
        <Empty>No accounts yet. Add them under Accounts.</Empty>
      )}
    </Card>
  );
}

function BalanceRow({ b, currency }: { b: Balance; currency: string }) {
  return (
    <button type="button" className="row" onClick={() => go(`/account/${b.account.id}`)}>
      <span>{b.account.name}</span>
      <Money value={b.current} currency={currency} tone="auto" />
    </button>
  );
}

function TodoCard({ d }: { d: Derived }) {
  const open = d.todos
    .filter((t) => t.status !== 'done')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.name.localeCompare(b.name));
  const today = todayIso(d.now);
  return (
    <Card>
      <SectionHead
        title="To do"
        action={
          <span className="actions">
            <button type="button" className="link" onClick={() => openSheet({ type: 'todo' })}>
              Add
            </button>
            <button type="button" className="link" onClick={() => go('/more/todos')}>
              See all
            </button>
          </span>
        }
      />
      {open.length ? (
        <div className="rows">
          {open.slice(0, 6).map((t) => (
            <div key={t.id} className="todo">
              <button
                type="button"
                className="check"
                aria-label={`Mark "${t.name}" done`}
                onClick={() => patch('todos', t.id, { status: 'done' })}
              />
              <button type="button" className="todo-main" onClick={() => openSheet({ type: 'todo', id: t.id })}>
                <span>{t.name}</span>
                <small className={t.dueDate && t.dueDate < today ? 'neg' : ''}>
                  {[t.tag === 'reminder' ? 'Reminder' : '', t.dueDate ? `due ${dateLabel(t.dueDate)}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty>Nothing to do.</Empty>
      )}
    </Card>
  );
}

/* ---------- Expense ---------- */

export function ExpensePage() {
  const d = useDerived();
  const [month, setMonth] = useState(d.month);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const plan = useMemo(
    () => (month === d.month ? d.plan : computePlan(d.ix, month, d.savingsTarget)),
    [d.ix, d.plan, d.month, d.savingsTarget, month],
  );
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return asItems(
      d.expenses.filter(
        (e) =>
          e.month === month &&
          (!category || e.expense.categoryId === category) &&
          (!q || e.expense.name.toLowerCase().includes(q)),
      ),
      [],
    );
  }, [d.expenses, month, category, query]);

  return (
    <>
      <MonthNav month={month} onChange={setMonth} current={d.month} />
      <Card>
        <SectionHead title={month === d.month ? 'This month plan' : 'Plan'} />
        <PlanCard plan={plan} currency={d.currency} />
      </Card>

      <Card>
        <SectionHead
          title="Monthly budget"
          action={
            <button type="button" className="link" onClick={() => go('/more/budget')}>
              Manage categories
            </button>
          }
        />
        {plan.expenseCategories.length ? (
          <div className="budget">
            {plan.expenseCategories.map((c) => (
              <button
                key={c.category.id}
                type="button"
                className={`budget-row ${category === c.category.id ? 'on' : ''}`}
                aria-pressed={category === c.category.id}
                onClick={() => setCategory(category === c.category.id ? null : c.category.id)}
              >
                <span className="budget-line">
                  <span>{displayName(c.category.name)}</span>
                  <span className="num">
                    <strong>{money(c.spent, d.currency)}</strong>
                    <small> / {money(c.limit, d.currency)}</small>
                  </span>
                </span>
                <Bar value={c.spent} max={c.limit} tone="spend" />
                <span className={`budget-left ${c.left < -0.004 ? 'neg' : ''}`}>
                  {c.left < -0.004 ? `${money(-c.left, d.currency)} over` : `${money(c.left, d.currency)} left`}
                  {c.progress !== null ? ` · ${percent(c.progress)}` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty>No expense categories yet.</Empty>
        )}
        {plan.uncategorisedSpent > 0.004 ? (
          <p className="note">
            {money(plan.uncategorisedSpent, d.currency)} of spending has no category and is left out of the budget.
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionHead
          title={category ? displayName(d.ix.expenseCategoryById.get(category)?.name ?? 'Category') : 'Transactions'}
          action={
            <button type="button" className="link" onClick={() => go('/expense/all')}>
              See all
            </button>
          }
        />
        <div className="search">
          <Icon name="search" size={18} />
          <input
            placeholder="Search this month"
            aria-label="Search expenses this month"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <TxList items={items} d={d} empty="No expenses here." />
        <p className="note">
          Spending counts your own share of each bill, spread costs at 1/N per month and refunds, so it can differ from
          the sum of the amounts listed.
        </p>
      </Card>
    </>
  );
}

/* ---------- Income ---------- */

type IncomeTab = 'all' | 'income' | 'card_payment' | 'transfer' | 'reimbursement';

export function IncomePage() {
  const d = useDerived();
  const [month, setMonth] = useState(d.month);
  const [tab, setTab] = useState<IncomeTab>('all');
  const plan = useMemo(
    () => (month === d.month ? d.plan : computePlan(d.ix, month, d.savingsTarget)),
    [d.ix, d.plan, d.month, d.savingsTarget, month],
  );
  const items = useMemo(
    () =>
      asItems(
        [],
        d.incomes.filter((i) => i.month === month && (tab === 'all' || i.type === tab)),
      ),
    [d.incomes, month, tab],
  );

  return (
    <>
      <MonthNav month={month} onChange={setMonth} current={d.month} />
      <Card>
        <SectionHead title={month === d.month ? 'This month plan' : 'Plan'} />
        <PlanCard plan={plan} currency={d.currency} />
      </Card>

      <Card>
        <SectionHead
          title="Monthly target"
          action={
            <button type="button" className="link" onClick={() => go('/more/budget')}>
              Manage categories
            </button>
          }
        />
        {plan.incomeCategories.length ? (
          <div className="budget">
            {plan.incomeCategories.map((c) => (
              <div key={c.category.id} className="budget-row static">
                <span className="budget-line">
                  <span>{displayName(c.category.name)}</span>
                  <span className="num">
                    <strong>{money(c.received, d.currency)}</strong>
                    {c.counted ? <small> / {money(c.target, d.currency)}</small> : null}
                  </span>
                </span>
                {c.counted ? (
                  <Bar value={c.received} max={c.target} />
                ) : (
                  <span className="budget-left">not counted as income</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty>No income categories yet.</Empty>
        )}
      </Card>

      <Card>
        <SectionHead
          title="Transactions"
          action={
            <button type="button" className="link" onClick={() => go('/income/all')}>
              See all
            </button>
          }
        />
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'income', label: 'Income' },
            { value: 'card_payment', label: 'Card payments' },
            { value: 'transfer', label: 'Transfers' },
            { value: 'reimbursement', label: 'Reimbursements' },
          ]}
        />
        <TxList items={items} d={d} showIssues empty="Nothing here this month." />
        <p className="note">
          Only income-type categories count as Received. Transfers, card payments and reimbursements move balances but
          are not income.
        </p>
      </Card>
    </>
  );
}

/* ---------- All transactions ---------- */

export function AllPage({ kind }: { kind: 'expense' | 'income' }) {
  const d = useDerived();
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cats = kind === 'expense' ? d.ix.expenseCategoryById : d.ix.incomeCategoryById;
    const match = (name: string, categoryId: string | null, pmId: string | null) =>
      !q ||
      name.toLowerCase().includes(q) ||
      (categoryId ? (cats.get(categoryId)?.name ?? '').toLowerCase().includes(q) : false) ||
      (pmId ? (d.ix.paymentMethodById.get(pmId)?.name ?? '').toLowerCase().includes(q) : false);
    return kind === 'expense'
      ? asItems(
          d.expenses.filter((e) => match(e.expense.name, e.expense.categoryId, e.expense.paymentMethodId)),
          [],
        )
      : asItems(
          [],
          d.incomes.filter((i) => match(i.income.name, i.income.categoryId, i.income.paymentMethodId)),
        );
  }, [d, kind, query]);
  const total = items.reduce(
    (a, item) => a + (item.kind === 'expense' ? item.info.expense.amount : item.info.income.amount),
    0,
  );
  return (
    <Card>
      <div className="search">
        <Icon name="search" size={18} />
        <input
          placeholder="Search by name, category or account"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="note">
        {items.length} {items.length === 1 ? 'row' : 'rows'} · {money(total, d.currency)}
      </p>
      <TxList items={items} d={d} showIssues={kind === 'income'} empty="Nothing found." />
    </Card>
  );
}

/* ---------- Accounts (assets & liabilities) ---------- */

export function AccountsPage() {
  const d = useDerived();
  const [type, setType] = useState<'asset' | 'liability'>('asset');
  const cats = type === 'asset' ? d.netWorth.assetCategories : d.netWorth.liabilityCategories;
  const total = type === 'asset' ? d.netWorth.assets : d.netWorth.liabilities;
  const unchecked = d.data.accounts.filter(
    (a) => !a.archived && (!a.inNetWorth || !a.categoryId || !d.ix.assetCategoryById.has(a.categoryId)),
  );
  const archived = d.data.accounts.filter((a) => a.archived);

  return (
    <>
      <Card>
        <SectionHead title="Net worth" />
        <div className="networth">
          <div className="big">
            <Money value={d.netWorth.netWorth} currency={d.currency} tone="auto" />
          </div>
          <div className="networth-split">
            <span>
              Assets <Money value={d.netWorth.assets} currency={d.currency} />
            </span>
            <span>
              Liabilities <Money value={d.netWorth.liabilities} currency={d.currency} tone="auto" />
            </span>
          </div>
        </div>
      </Card>

      <Tabs
        value={type}
        onChange={setType}
        options={[
          { value: 'asset', label: 'Assets' },
          { value: 'liability', label: 'Liabilities' },
        ]}
      />

      {cats.map((c) => (
        <CategoryCard key={c.category?.id ?? 'none'} c={c} d={d} total={total} />
      ))}
      {!cats.length ? (
        <Card>
          <Empty>{type === 'asset' ? 'No assets yet.' : 'No liabilities yet.'}</Empty>
        </Card>
      ) : null}

      <button type="button" className="btn block" onClick={() => openSheet({ type: 'account', accountType: type })}>
        <Icon name="plus" size={18} /> New {type === 'asset' ? 'asset' : 'liability'}
      </button>

      {unchecked.length ? (
        <Card>
          <SectionHead title="⚠️ Check" />
          <div className="rows">
            {unchecked.map((a) => (
              <button key={a.id} type="button" className="row" onClick={() => openSheet({ type: 'account', id: a.id })}>
                <span>{a.name}</span>
                <small>{!a.inNetWorth ? 'not counted in net worth' : 'no category'}</small>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {archived.length ? (
        <Card>
          <SectionHead title="Archived" />
          <div className="rows">
            {byName(archived).map((a) => (
              <button key={a.id} type="button" className="row" onClick={() => go(`/account/${a.id}`)}>
                <span>{a.name}</span>
                <Money value={d.balances.get(a.id)?.current ?? 0} currency={d.currency} tone="muted" />
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function CategoryCard({ c, d, total }: { c: CategoryTotal; d: Derived; total: number }) {
  return (
    <Card>
      <SectionHead
        title={c.category?.name ?? 'No category'}
        action={
          <span className="num muted">
            {money(c.total, d.currency)}
            {total !== 0 ? ` · ${percent(c.share)}` : ''}
          </span>
        }
      />
      <Bar value={Math.abs(c.total)} max={Math.abs(total)} />
      <div className="rows">
        {c.balances.map((b) => (
          <button key={b.account.id} type="button" className="row" onClick={() => go(`/account/${b.account.id}`)}>
            <span>
              {b.account.name}
              {Math.abs(b.growth) > 0.004 ? (
                <small className={b.growth < 0 ? 'neg' : 'pos'}>
                  {b.growth > 0 ? '+' : ''}
                  {money(b.growth, d.currency)} since start
                </small>
              ) : null}
            </span>
            <Money value={b.current} currency={d.currency} tone="auto" />
          </button>
        ))}
      </div>
    </Card>
  );
}

export function AccountPage({ id }: { id: string }) {
  const d = useDerived();
  const b = d.balances.get(id);
  const pmIds = useMemo(
    () => new Set(d.data.paymentMethods.filter((p) => p.accountId === id).map((p) => p.id)),
    [d.data.paymentMethods, id],
  );
  const ledger = useMemo(() => {
    const rows: Array<{ item: TxItem; delta: number }> = [];
    for (const info of d.expenses) {
      const e = info.expense;
      let delta = 0;
      if (e.paymentMethodId && pmIds.has(e.paymentMethodId)) delta -= e.amount;
      if (e.targetAccountId === id) delta += e.amount;
      if (delta !== 0 || e.targetAccountId === id) rows.push({ item: { kind: 'expense', info }, delta });
    }
    for (const info of d.incomes) {
      const i = info.income;
      let delta = 0;
      if (i.paymentMethodId && pmIds.has(i.paymentMethodId)) delta += i.amount;
      if (i.sourceAccountId === id) delta -= i.amount;
      if (delta !== 0 || i.sourceAccountId === id) rows.push({ item: { kind: 'income', info }, delta });
    }
    return rows.sort((a, z) => z.item.info.time - a.item.info.time);
  }, [d.expenses, d.incomes, pmIds, id]);
  const [limit, setLimit] = useState(50);

  if (!b) {
    return (
      <Card>
        <Empty>This account no longer exists.</Empty>
      </Card>
    );
  }
  const { account } = b;
  const category = account.categoryId ? d.ix.assetCategoryById.get(account.categoryId) : undefined;
  const methods = byName(d.data.paymentMethods.filter((p) => p.accountId === id));

  return (
    <>
      <Card>
        <SectionHead
          title={category?.name ?? (account.type === 'asset' ? 'Asset' : 'Liability')}
          action={
            <button type="button" className="link" onClick={() => openSheet({ type: 'account', id })}>
              Edit
            </button>
          }
        />
        <div className="networth">
          <div className="big">
            <Money value={b.current} currency={d.currency} tone="auto" />
          </div>
          <div className="networth-split">
            <span>
              Started at <Money value={account.initialValue} currency={d.currency} />
            </span>
            <span>
              Change <Money value={b.growth} currency={d.currency} tone="auto" plus />
            </span>
          </div>
        </div>
        <dl className="facts">
          <div>
            <dt>Paid in</dt>
            <dd>{money(b.payIn, d.currency)}</dd>
          </div>
          <div>
            <dt>Paid out</dt>
            <dd>{money(b.payOut, d.currency)}</dd>
          </div>
          <div>
            <dt>Value added</dt>
            <dd>{money(b.transIn, d.currency)}</dd>
          </div>
          <div>
            <dt>Value taken</dt>
            <dd>{money(b.transOut, d.currency)}</dd>
          </div>
        </dl>
        <p className="note">
          {methods.length
            ? `Payment methods: ${methods.map((m) => m.name).join(', ')}.`
            : 'No payment method is linked, so this account only changes through Target asset / Source asset.'}
          {account.inNetWorth ? '' : ' Not counted in net worth.'}
          {account.purchasedDate ? ` Since ${dateLabel(account.purchasedDate)}.` : ''}
        </p>
      </Card>

      <Card>
        <SectionHead title="Activity" />
        {ledger.length ? (
          <div className="tx-list">
            {ledger.slice(0, limit).map(({ item, delta }) => (
              <div key={item.kind + (item.kind === 'expense' ? item.info.expense.id : item.info.income.id)} className="ledger">
                <TxRow item={item} d={d} />
                <span className={`ledger-delta num ${delta < 0 ? 'neg' : 'pos'}`}>
                  {delta > 0 ? '+' : ''}
                  {money(delta, d.currency)} · {dayLabel(dayOf(item.info.time), d.now)}
                </span>
              </div>
            ))}
            {ledger.length > limit ? (
              <button type="button" className="btn block" onClick={() => setLimit(limit + 150)}>
                Show more ({ledger.length - limit} left)
              </button>
            ) : null}
          </div>
        ) : (
          <Empty>No transactions touch this account yet.</Empty>
        )}
      </Card>
    </>
  );
}
