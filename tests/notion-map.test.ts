import { describe, expect, it } from 'vitest';
import { mapPage } from '@/lib/server/notion';
import { notionPage as page, prop } from './notion-fixtures';

describe('mapping Notion pages to rows', () => {
  it('maps an expense', () => {
    const row = mapPage(
      'expenses',
      page('11111111-2222-4333-8444-555555555555', {
        Name: prop.title('train'),
        Amount: prop.number(2.42),
        Date: prop.date('2026-10-13T07:28:00.000+08:00'),
        Category: prop.relation('cat-transport'),
        'Account (-)': prop.relation('pm-visa'),
        'Target Asset (+)': prop.relation(),
        'My Share': prop.number(null),
        'Split with': prop.text(''),
        'Spread (months)': prop.number(null),
        "Don't Include": prop.checkbox(false),
        // Formula and rollup columns are ignored.
        'My Cost': { type: 'formula', formula: { type: 'number', number: 2.42 } },
        Repaid: { type: 'rollup', rollup: { type: 'number', number: 0 } },
      }),
    );
    expect(row).toEqual({
      table: 'expenses',
      id: '11111111-2222-4333-8444-555555555555',
      data: {
        name: 'train',
        amount: 2.42,
        date: '2026-10-12T23:28:00.000Z',
        categoryId: 'cat-transport',
        paymentMethodId: 'pm-visa',
        targetAccountId: null,
        myShare: null,
        splitWith: '',
        spreadMonths: null,
        exclude: false,
        createdAt: '2026-10-12T23:28:01.000Z',
        source: 'notion',
      },
    });
  });

  it('keeps split, spread, target asset and Don’t Include', () => {
    const row = mapPage(
      'expenses',
      page('e2', {
        Name: prop.title('  team   dinner '),
        Amount: prop.number(200),
        Date: prop.date('2026-10-10'),
        'My Share': prop.number(0),
        'Split with': prop.text('wei, sam'),
        'Spread (months)': prop.number(12),
        'Target Asset (+)': prop.relation('acct-broker'),
        'Don’t Include': prop.checkbox(true), // curly apostrophe in the property name
      }),
    )!;
    expect(row.data).toMatchObject({
      name: 'team dinner',
      date: '2026-10-10T12:00:00.000Z',
      myShare: 0,
      splitWith: 'wei, sam',
      spreadMonths: 12,
      targetAccountId: 'acct-broker',
      exclude: true,
      categoryId: null,
      paymentMethodId: null,
    });
  });

  it('falls back to the created time and 0 when date or amount are empty', () => {
    const row = mapPage('expenses', page('e3', { Name: prop.title('draft'), Amount: prop.number(null), Date: { type: 'date', date: null } }))!;
    expect(row.data).toMatchObject({ amount: 0, date: '2026-10-12T23:28:01.000Z' });
  });

  it('maps an income row with its source asset and linked expense', () => {
    const row = mapPage(
      'incomes',
      page('i1', {
        Name: prop.title('pay credit card'),
        Amount: prop.number(250.5),
        Date: prop.date('2026-10-10T01:02:00.000+00:00'),
        Category: prop.relation('cat-card'),
        'Account (+)': prop.relation('pm-visa'),
        'Source Asset (-)': prop.relation('acct-bank'),
        'For Expense': prop.relation('e1', 'e2'),
        "Don't Include": prop.checkbox(false),
      }),
    )!;
    expect(row.table).toBe('incomes');
    expect(row.data).toMatchObject({
      amount: 250.5,
      date: '2026-10-10T01:02:00.000Z',
      categoryId: 'cat-card',
      paymentMethodId: 'pm-visa',
      sourceAccountId: 'acct-bank',
      expenseId: 'e1',
      source: 'notion',
    });
  });

  it('maps categories, accounts and payment methods', () => {
    expect(mapPage('expenseCategories', page('c1', { Name: prop.title('0 | Food & Drinks'), Limit: prop.number(350) }))!.data).toEqual({
      name: '0 | Food & Drinks',
      budgetLimit: 350,
    });
    expect(
      mapPage('incomeCategories', page('c2', { Name: prop.title('6 | Credit Card Payment'), Type: prop.select('Card Payment'), Target: prop.number(0) }))!.data,
    ).toEqual({ name: '6 | Credit Card Payment', type: 'card_payment', target: 0 });
    expect(mapPage('assetCategories', page('k1', { Name: prop.title('Short Term Liability'), Type: prop.select('Liabilities') }))!.data).toEqual({
      name: 'Short Term Liability',
      type: 'liability',
      kind: 'short',
    });
    expect(
      mapPage(
        'accounts',
        page('a1', {
          Name: prop.title('Visa Credit \n'),
          Type: prop.select('Liability'),
          'Initial Value': prop.number(null),
          Category: prop.relation('k1'),
          'Purchased Date': prop.date('2026-01-04'),
          'Net Worth Overview': prop.relation('o1', 'o2'),
        }),
      )!.data,
    ).toEqual({
      name: 'Visa Credit',
      type: 'liability',
      categoryId: 'k1',
      initialValue: 0,
      purchasedDate: '2026-01-04',
      inNetWorth: true,
    });
    expect(
      mapPage('accounts', page('a2', { Name: prop.title('Old'), Type: prop.select('Assets'), 'Net Worth Overview': prop.relation() }))!.data,
    ).toMatchObject({ type: 'asset', inNetWorth: false });
    expect(
      mapPage('paymentMethods', page('p1', { Name: prop.title('PayNow'), Type: prop.select('E Wallet'), 'Link to Asset': prop.relation('a-bank') }))!.data,
    ).toEqual({ name: 'PayNow', type: 'ewallet', accountId: 'a-bank' });
  });

  it('maps the plan row and to-dos, and skips unnamed rows', () => {
    expect(mapPage('plan', page('pl', { Name: prop.title('This Month'), 'Savings Target': prop.number(1000) }))).toEqual({
      table: 'settings',
      id: 'savingsTarget',
      data: { value: 1000 },
    });
    expect(mapPage('plan', page('pl2', { Name: prop.title('Old plan'), 'Savings Target': prop.number(5) }))).toBeNull();
    expect(
      mapPage('todos', page('t1', { Name: prop.title('file taxes'), Status: prop.status('In progress'), Tags: prop.select('Reminder'), 'Due Date': prop.date('2026-11-30') }))!.data,
    ).toMatchObject({ name: 'file taxes', status: 'in_progress', tag: 'reminder', dueDate: '2026-11-30' });
    expect(mapPage('assetCategories', page('k2', { Name: prop.title(''), Type: prop.select('Liabilities') }))).toBeNull();
  });
});
