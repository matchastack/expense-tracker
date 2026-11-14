/**
 * Integration tests for the sync layer and the Notion import, against a real
 * Postgres database and a local stand-in for Notion's API.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost/mf_test npm test
 *
 * The target database is wiped. Skipped when TEST_DATABASE_URL is not set.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Op } from '@/lib/schema';
import { notionDatabase, notionPage, prop } from './notion-fixtures';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type SyncModule = typeof import('@/lib/server/sync');
type NotionModule = typeof import('@/lib/server/notion');
type DbModule = typeof import('@/lib/server/db');

let syncMod: SyncModule;
let notionMod: NotionModule;
let db: DbModule;

const op = (table: Op['table'], id: string, data: Op['data']): Op => ({ opId: `${table}-${id}`, table, id, data });

async function resetDatabase() {
  await db.getPool().query('drop schema public cascade; create schema public;');
  (globalThis as { __mfSchema?: unknown }).__mfSchema = undefined;
}

beforeAll(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  db = await import('@/lib/server/db');
  syncMod = await import('@/lib/server/sync');
  notionMod = await import('@/lib/server/notion');
  await resetDatabase();
});

afterAll(async () => {
  if (url) await db.getPool().end();
});

suite('sync', () => {
  it('starts empty', async () => {
    expect(await syncMod.sync(0, [])).toEqual({ cursor: 0, rows: {} });
  });

  it('stores changes and returns them with typed values', async () => {
    const res = await syncMod.sync(0, [
      op('expenseCategories', 'food', { name: '0 | Food & Drinks', budgetLimit: 350, archived: false }),
      op('expenses', 'e1', {
        name: 'lunch',
        amount: 4.8,
        date: '2026-11-14T12:30:00+08:00',
        categoryId: 'food',
        paymentMethodId: null,
        targetAccountId: null,
        myShare: null,
        splitWith: '',
        spreadMonths: null,
        exclude: false,
        createdAt: '2026-11-14T04:30:05.000Z',
        source: 'app',
      }),
      op('accounts', 'a1', { name: 'Cash', type: 'asset', initialValue: 149, purchasedDate: '2026-05-16' }),
      op('settings', 'savingsTarget', { value: 1000 }),
    ]);
    expect(res.cursor).toBeGreaterThan(0);
    expect(res.rows.expenses).toEqual([
      {
        id: 'e1',
        name: 'lunch',
        amount: 4.8,
        date: new Date('2026-11-14T04:30:00.000Z'),
        categoryId: 'food',
        paymentMethodId: null,
        targetAccountId: null,
        myShare: null,
        splitWith: '',
        spreadMonths: null,
        exclude: false,
        createdAt: new Date('2026-11-14T04:30:05.000Z'),
        source: 'app',
      },
    ]);
    expect(res.rows.accounts?.[0]).toMatchObject({
      name: 'Cash',
      initialValue: 149,
      purchasedDate: '2026-05-16',
      inNetWorth: true,
      archived: false,
      categoryId: null,
    });
    expect(res.rows.settings).toEqual([{ id: 'savingsTarget', value: 1000 }]);
    // What the browser receives is JSON: timestamps arrive as ISO strings.
    expect(JSON.parse(JSON.stringify(res)).rows.expenses[0].date).toBe('2026-11-14T04:30:00.000Z');
  });

  it('returns only what changed since the cursor', async () => {
    const first = await syncMod.sync(0, []);
    expect(Object.keys(first.rows).sort()).toEqual(['accounts', 'expenseCategories', 'expenses', 'settings']);
    expect(await syncMod.sync(first.cursor, [])).toEqual({ cursor: first.cursor, rows: {} });

    const next = await syncMod.sync(first.cursor, [op('todos', 't1', { name: 'file taxes' })]);
    expect(Object.keys(next.rows)).toEqual(['todos']);
    expect(next.rows.todos?.[0]).toMatchObject({ name: 'file taxes', status: 'not_started', tag: 'task', dueDate: null });
    expect(next.cursor).toBeGreaterThan(first.cursor);
  });

  it('updates only the columns it is given', async () => {
    await syncMod.sync(0, [op('expenseCategories', 'food', { archived: true })]);
    const { rows } = await syncMod.sync(0, [op('expenseCategories', 'food', { name: '0 | Food', budgetLimit: 400 })]);
    expect(rows.expenseCategories).toEqual([{ id: 'food', name: '0 | Food', budgetLimit: 400, archived: true }]);
  });

  it('is idempotent when the same change is sent twice', async () => {
    const change = op('todos', 't2', { name: 'renew card', status: 'in_progress' });
    await syncMod.sync(0, [change]);
    const { rows } = await syncMod.sync(0, [change]);
    expect(rows.todos?.filter((t) => t.id === 't2')).toHaveLength(1);
  });

  it('deletes with a tombstone and can bring a row back', async () => {
    const before = await syncMod.sync(0, []);
    const res = await syncMod.sync(before.cursor, [op('todos', 't1', null)]);
    expect(res.rows.todos).toEqual([{ id: 't1', deleted: true }]);
    const back = await syncMod.sync(res.cursor, [op('todos', 't1', { name: 'file taxes again' })]);
    expect(back.rows.todos?.[0]).toMatchObject({ id: 't1', name: 'file taxes again' });
    expect(back.rows.todos?.[0].deleted).toBeUndefined();
  });

  it('rounds money to cents', async () => {
    const { rows } = await syncMod.sync(0, [op('expenses', 'e2', { name: 'x', amount: 10.005, myShare: 3.333 })]);
    expect(rows.expenses?.find((e) => e.id === 'e2')).toMatchObject({ amount: 10.01, myShare: 3.33 });
  });

  it('rejects malformed changes', () => {
    const bad = (ops: unknown) => () => syncMod.validateOps(ops);
    expect(bad('nope')).toThrow('ops must be an array');
    expect(bad([{ table: 'users', id: 'x', data: {} }])).toThrow('Unknown table');
    expect(bad([{ table: 'todos', id: '', data: {} }])).toThrow('Bad row id');
    expect(bad([{ table: 'todos', id: 'x', data: [] }])).toThrow('Bad row data');
  });

  it('rejects invalid values and leaves the database untouched', async () => {
    const attempt = (data: Record<string, unknown>) =>
      syncMod.sync(0, [op('todos', 'ok-first', { name: 'should roll back' }), op('incomeCategories', 'bad', data)]);
    await expect(attempt({ type: 'gift' })).rejects.toThrow('Invalid value for incomeCategories.type');
    await expect(attempt({ target: 'lots' })).rejects.toThrow('Invalid value for incomeCategories.target');
    await expect(syncMod.sync(0, [op('expenses', 'bad', { date: 'yesterday' })])).rejects.toThrow('Invalid value');
    await expect(syncMod.sync(-1, [])).rejects.toThrow('Bad cursor');
    const { rows } = await syncMod.sync(0, []);
    expect(rows.todos?.some((t) => t.id === 'ok-first')).toBe(false);
    expect(rows.incomeCategories).toBeUndefined();
  });
});

/* ---------- A stand-in for the Notion API ---------- */

interface FakeNotion {
  databases: Array<ReturnType<typeof notionDatabase>>;
  pages: Record<string, Array<ReturnType<typeof notionPage>>>;
  requests: string[];
  /** How the fake reacts to ?filter_properties=…: honour it, reject it, or return rows stripped of everything. */
  filterMode: 'honour' | 'reject' | 'strip';
}

function startFakeNotion(state: FakeNotion): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      state.requests.push(`${req.method} ${req.url}`);
      if (req.headers.authorization !== 'Bearer secret_good_token_1234567890') {
        return send(401, { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' });
      }
      if (req.headers['notion-version'] !== '2022-06-28') return send(400, { message: 'missing version' });
      const body = raw ? JSON.parse(raw) : {};
      const paginate = <T,>(all: T[], size: number) => {
        const start = body.start_cursor ? Number(body.start_cursor) : 0;
        const results = all.slice(start, start + size);
        const next = start + size < all.length ? String(start + size) : null;
        return { object: 'list', results, has_more: next !== null, next_cursor: next };
      };
      const url = new URL(req.url ?? '/', 'http://notion.test');
      if (url.pathname === '/v1/search') return send(200, paginate(state.databases, 4));
      const query = url.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/);
      if (query) {
        const pages = state.pages[query[1]];
        if (!pages) return send(404, { object: 'error', status: 404, message: 'Could not find database.' });
        const list = paginate(pages, body.page_size ?? 100);
        const wanted = url.searchParams.getAll('filter_properties'); // decoded once, like a real server
        if (wanted.length) {
          if (state.filterMode === 'reject') {
            return send(400, { object: 'error', status: 400, code: 'validation_error', message: 'filter_properties is invalid.' });
          }
          const schema = (state.databases.find((d) => d.id === query[1])?.properties ?? {}) as Record<string, { id: string }>;
          const keep = new Set(
            state.filterMode === 'strip'
              ? []
              : Object.entries(schema)
                  .filter(([, p]) => wanted.includes(decodeURIComponent(p.id)))
                  .map(([name]) => name),
          );
          list.results = list.results.map((p) => ({
            ...p,
            properties: Object.fromEntries(Object.entries(p.properties).filter(([name]) => keep.has(name))),
          }));
        }
        return send(200, list);
      }
      send(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const dbId = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const TOKEN = 'secret_good_token_1234567890';

function buildWorkspace(): FakeNotion {
  const expenses = Array.from({ length: 230 }, (_, i) =>
    notionPage(`exp-${i}`, {
      Name: prop.title(i % 3 ? 'train' : 'lunch'),
      Amount: prop.number(2 + (i % 7)),
      Date: prop.date(`2026-10-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000+08:00`),
      Category: prop.relation('cat-food'),
      'Account (-)': prop.relation('pm-bank'),
      'Target Asset (+)': prop.relation(),
      'My Share': prop.number(null),
      'Split with': prop.text(''),
      'Spread (months)': prop.number(null),
      "Don't Include": prop.checkbox(i % 10 === 0),
      // Computed columns the import has no use for:
      'My Cost': { type: 'formula', formula: { type: 'number', number: 1 } },
      Repaid: { type: 'rollup', rollup: { type: 'number', number: 0 } },
    }),
  );
  // Notion returns property ids percent-encoded.
  const expenseSchema = {
    Name: { id: 'title', type: 'title' },
    Amount: { id: 'eUdJ%3Ap', type: 'number', number: { format: 'singapore_dollar' } },
    Date: { id: 'a%40b', type: 'date' },
    Category: { id: 'dFRT', type: 'relation' },
    'Account (-)': { id: 'ZERx', type: 'relation' },
    'Target Asset (+)': { id: 'UXNV', type: 'relation' },
    'My Share': { id: 'shr1', type: 'number' },
    'Split with': { id: 'spl1', type: 'rich_text' },
    'Spread (months)': { id: 'spr1', type: 'number' },
    "Don't Include": { id: 'dnt1', type: 'checkbox' },
    'My Cost': { id: 'Q307', type: 'formula' },
    Repaid: { id: 'rep1', type: 'rollup' },
  };
  return {
    requests: [],
    filterMode: 'honour',
    databases: [
      notionDatabase(dbId(1), 'Asset Category'),
      notionDatabase(dbId(2), 'Assets & Liabilities'),
      notionDatabase(dbId(3), 'Payment Method'),
      notionDatabase(dbId(4), 'Expense Category'),
      notionDatabase(dbId(5), 'Income Category'),
      notionDatabase(dbId(6), 'All Expense', expenseSchema),
      notionDatabase(dbId(7), 'All Income'),
      notionDatabase(dbId(8), 'Income Plan'),
      notionDatabase(dbId(9), 'To Do Tracker'),
      notionDatabase(dbId(10), 'Widget Library'),
      { ...notionDatabase(dbId(11), 'All Expense'), in_trash: true },
    ],
    pages: {
      [dbId(1)]: [
        notionPage('k-liquid', { Name: prop.title('Liquid Asset'), Type: prop.select('Assets') }),
        notionPage('k-short', { Name: prop.title('Short Term Liability'), Type: prop.select('Liabilities') }),
        notionPage('k-blank', { Name: prop.title(''), Type: prop.select('Liabilities') }),
      ],
      [dbId(2)]: [
        notionPage('a-bank', {
          Name: prop.title('Main Bank'),
          Type: prop.select('Assets'),
          'Initial Value': prop.number(500),
          Category: prop.relation('k-liquid'),
          'Net Worth Overview': prop.relation('o'),
        }),
        notionPage('a-visa', {
          Name: prop.title('Visa Credit'),
          Type: prop.select('Liability'),
          'Initial Value': prop.number(null),
          Category: prop.relation('k-short'),
          'Net Worth Overview': prop.relation('o'),
        }),
      ],
      [dbId(3)]: [
        notionPage('pm-bank', { Name: prop.title('Main Bank'), Type: prop.select('Bank Account'), 'Link to Asset': prop.relation('a-bank') }),
        notionPage('pm-visa', { Name: prop.title('Visa'), Type: prop.select('Credit Card'), 'Link to Asset': prop.relation('a-visa') }),
      ],
      [dbId(4)]: [notionPage('cat-food', { Name: prop.title('0 | Food & Drinks'), Limit: prop.number(350) })],
      [dbId(5)]: [
        notionPage('cat-salary', { Name: prop.title('1 | Salary'), Type: prop.select('Income'), Target: prop.number(6000) }),
        notionPage('cat-card', { Name: prop.title('6 | Credit Card Payment'), Type: prop.select('Card Payment'), Target: prop.number(0) }),
      ],
      [dbId(6)]: expenses,
      [dbId(7)]: [
        notionPage('inc-salary', {
          Name: prop.title('salary'),
          Amount: prop.number(5200),
          Date: prop.date('2026-10-17T10:46:00.000+08:00'),
          Category: prop.relation('cat-salary'),
          'Account (+)': prop.relation('pm-bank'),
          'Source Asset (-)': prop.relation(),
          'For Expense': prop.relation(),
          "Don't Include": prop.checkbox(false),
        }),
        notionPage('inc-card', {
          Name: prop.title('pay credit card'),
          Amount: prop.number(100),
          Date: prop.date('2026-10-20T10:00:00.000+08:00'),
          Category: prop.relation('cat-card'),
          'Account (+)': prop.relation('pm-visa'),
          'Source Asset (-)': prop.relation('a-bank'),
          'For Expense': prop.relation(),
          "Don't Include": prop.checkbox(false),
        }),
      ],
      [dbId(8)]: [notionPage('plan', { Name: prop.title('This Month'), 'Savings Target': prop.number(1000) })],
      [dbId(9)]: [notionPage('todo-1', { Name: prop.title('file taxes'), Status: prop.status('Not started'), Tags: prop.select('Task') })],
    },
  };
}

/** Drive the import the way the browser does. */
async function runImport() {
  const found = await notionMod.discover(TOKEN);
  const seen: Record<string, string[]> = { expenses: [], incomes: [] };
  const counts: Record<string, number> = {};
  for (const source of found.databases) {
    let cursor: string | null = null;
    do {
      const page = await notionMod.importPage(TOKEN, source.key, source.id, cursor, source.props);
      counts[source.key] = (counts[source.key] ?? 0) + page.count;
      if (source.key in seen) seen[source.key].push(...page.ids);
      cursor = page.next;
    } while (cursor);
  }
  const finish = await notionMod.finishImport(seen, found.currency);
  return { found, counts, finish };
}

suite('import from Notion', () => {
  let server: http.Server;
  let workspace: FakeNotion;

  beforeAll(async () => {
    await resetDatabase();
    workspace = buildWorkspace();
    server = await startFakeNotion(workspace);
    process.env.NOTION_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('finds the databases by title, ignoring trashed and unrelated ones', async () => {
    const found = await notionMod.discover(TOKEN);
    expect(found.databases.map((d) => d.key)).toEqual([
      'assetCategories',
      'accounts',
      'paymentMethods',
      'expenseCategories',
      'incomeCategories',
      'expenses',
      'incomes',
      'plan',
      'todos',
    ]);
    const expenses = found.databases.find((d) => d.key === 'expenses');
    expect(expenses?.id).toBe(dbId(6));
    // Only the columns the import reads, never formulas or rollups.
    expect(expenses?.props).toEqual(['title', 'eUdJ%3Ap', 'a%40b', 'dFRT', 'ZERx', 'UXNV', 'shr1', 'spl1', 'spr1', 'dnt1']);
    expect(found.currency).toBe('S$');
  });

  it('imports everything, page by page', async () => {
    const { counts, finish } = await runImport();
    expect(counts).toEqual({
      assetCategories: 2,
      accounts: 2,
      paymentMethods: 2,
      expenseCategories: 1,
      incomeCategories: 2,
      expenses: 230,
      incomes: 2,
      plan: 1,
      todos: 1,
    });
    expect(finish.removed).toBe(0);
    // 230 expenses at 100 per request = 3 requests for that database, each asking only for the needed columns.
    const expenseRequests = workspace.requests.filter((r) => r.includes(dbId(6)));
    expect(expenseRequests).toHaveLength(3);
    expect(expenseRequests[0]).toContain('filter_properties=eUdJ%3Ap');
    expect(expenseRequests[0]).not.toContain('Q307');

    const { rows } = await syncMod.sync(0, []);
    expect(rows.expenses).toHaveLength(230);
    expect(rows.expenses?.find((e) => e.id === 'exp-0')).toMatchObject({
      name: 'lunch',
      amount: 2,
      categoryId: 'cat-food',
      paymentMethodId: 'pm-bank',
      exclude: true,
      source: 'notion',
    });
    expect(rows.accounts?.find((a) => a.id === 'a-visa')).toMatchObject({ type: 'liability', initialValue: 0, categoryId: 'k-short' });
    expect(rows.paymentMethods?.find((p) => p.id === 'pm-visa')).toMatchObject({ type: 'card', accountId: 'a-visa' });
    expect(rows.incomes?.find((i) => i.id === 'inc-card')).toMatchObject({ sourceAccountId: 'a-bank', paymentMethodId: 'pm-visa' });
    const settings = Object.fromEntries((rows.settings ?? []).map((s) => [s.id, s.value]));
    expect(settings.savingsTarget).toBe(1000);
    expect(settings.currency).toBe('S$');
    expect(typeof settings.fixSince).toBe('string');
  });

  it('can be run again without duplicating, and follows deletions and edits in Notion', async () => {
    // Changes made in the app between imports:
    await syncMod.sync(0, [
      op('expenses', 'app-1', { name: 'logged in the app', amount: 5 }),
      op('expenseCategories', 'cat-food', { archived: true }),
      op('settings', 'currency', { value: '$' }),
    ]);
    const fixSince = (await syncMod.sync(0, [])).rows.settings?.find((s) => s.id === 'fixSince')?.value;

    workspace.pages[dbId(6)] = workspace.pages[dbId(6)].filter((p) => p.id !== 'exp-7');
    (workspace.pages[dbId(6)][0].properties as Record<string, unknown>).Amount = prop.number(99.5);

    const { finish } = await runImport();
    expect(finish.removed).toBe(1);

    const { rows } = await syncMod.sync(0, []);
    const live = rows.expenses?.filter((e) => !e.deleted) ?? [];
    expect(live).toHaveLength(230); // 229 from Notion + 1 logged in the app
    expect(live.find((e) => e.id === 'exp-0')?.amount).toBe(99.5);
    expect(live.some((e) => e.id === 'app-1')).toBe(true);
    expect(rows.expenses?.find((e) => e.id === 'exp-7')).toEqual({ id: 'exp-7', deleted: true });
    // Choices made in the app survive a re-import.
    expect(rows.expenseCategories?.[0]).toMatchObject({ name: '0 | Food & Drinks', archived: true });
    const settings = Object.fromEntries((rows.settings ?? []).map((s) => [s.id, s.value]));
    expect(settings.currency).toBe('$');
    expect(settings.fixSince).toBe(fixSince);
  });

  it('falls back to whole rows when Notion will not filter columns', async () => {
    for (const mode of ['reject', 'strip'] as const) {
      workspace.filterMode = mode;
      workspace.requests = [];
      const found = await notionMod.discover(TOKEN);
      const source = found.databases.find((d) => d.key === 'expenses')!;
      const page = await notionMod.importPage(TOKEN, source.key, source.id, null, source.props);
      expect(page.count).toBe(100);
      expect(workspace.requests.filter((r) => r.includes(dbId(6)))).toHaveLength(2); // filtered, then unfiltered
    }
    workspace.filterMode = 'honour';
    const { rows } = await syncMod.sync(0, []);
    // Rows were not blanked by the stripped response.
    expect(rows.expenses?.find((e) => e.id === 'exp-1')).toMatchObject({ name: 'train', amount: 3, categoryId: 'cat-food' });
  });

  it('never wipes transactions when a listing comes back empty', async () => {
    const res = await notionMod.finishImport({ expenses: [], incomes: [] }, null);
    expect(res.removed).toBe(0);
  });

  it('explains what is wrong', async () => {
    await expect(notionMod.discover('secret_wrong_token_1234567890')).rejects.toThrow('did not accept that token');

    const saved = workspace.databases;
    workspace.databases = saved.filter((d) => d.id !== dbId(7) && d.id !== dbId(3));
    await expect(notionMod.discover(TOKEN)).rejects.toThrow('Could not find: Payment Method, All Income');

    workspace.databases = [...saved, notionDatabase(dbId(12), 'All Income')];
    await expect(notionMod.discover(TOKEN)).rejects.toThrow('Found 2 databases named "All Income"');
    workspace.databases = saved;

    await expect(notionMod.importPage(TOKEN, 'users', dbId(6), null)).rejects.toThrow('Unknown import source');
    await expect(notionMod.importPage(TOKEN, 'expenses', '../etc', null)).rejects.toThrow('Bad database id');
    await expect(notionMod.importPage(TOKEN, 'expenses', dbId(99), null)).rejects.toThrow('Could not find database');
  });
});
