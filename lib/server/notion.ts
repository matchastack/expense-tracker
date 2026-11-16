/**
 * One-off (and repeatable) import from the "My Finance" Notion workspace,
 * through Notion's public API and an integration token supplied by the user.
 *
 * Notion page ids are kept as row ids, so importing again updates rows in
 * place instead of duplicating them.
 *
 * Uses the "data source" endpoints (API version 2025-09-03): a Notion database
 * holds one or more data sources, and rows are queried per data source.
 */
import { SETTING, type Op, type TableName } from '../schema';
import { withTransaction } from './db';
import { HttpError } from './http';
import { applyOps } from './sync';

const NOTION_VERSION = '2025-09-03';
const apiBase = () => process.env.NOTION_API_BASE || 'https://api.notion.com';

export type SourceKey =
  | 'assetCategories'
  | 'accounts'
  | 'paymentMethods'
  | 'expenseCategories'
  | 'incomeCategories'
  | 'expenses'
  | 'incomes'
  | 'plan'
  | 'todos';

interface Source {
  key: SourceKey;
  /** Title of the database (data source) in Notion. */
  title: string;
  label: string;
  required: boolean;
  /** The columns read from it. Everything else (formulas, rollups) is left out of the request. */
  columns: string[];
}

/** The Notion databases to read, in import order, matched by title. */
export const SOURCES: Source[] = [
  { key: 'assetCategories', title: 'Asset Category', label: 'Asset categories', required: true, columns: ['Type'] },
  {
    key: 'accounts',
    title: 'Assets & Liabilities',
    label: 'Accounts',
    required: true,
    columns: ['Type', 'Initial Value', 'Category', 'Purchased Date', 'Net Worth Overview'],
  },
  { key: 'paymentMethods', title: 'Payment Method', label: 'Payment methods', required: true, columns: ['Type', 'Link to Asset'] },
  { key: 'expenseCategories', title: 'Expense Category', label: 'Expense categories', required: true, columns: ['Limit'] },
  { key: 'incomeCategories', title: 'Income Category', label: 'Income categories', required: true, columns: ['Type', 'Target'] },
  {
    key: 'expenses',
    title: 'All Expense',
    label: 'Expenses',
    required: true,
    columns: ['Amount', 'Date', 'Category', 'Account (-)', 'Target Asset (+)', 'My Share', 'Split with', 'Spread (months)', "Don't Include"],
  },
  {
    key: 'incomes',
    title: 'All Income',
    label: 'Income',
    required: true,
    columns: ['Amount', 'Date', 'Category', 'Account (+)', 'Source Asset (-)', 'For Expense', "Don't Include"],
  },
  { key: 'plan', title: 'Income Plan', label: 'Savings target', required: false, columns: ['Savings Target'] },
  { key: 'todos', title: 'To Do Tracker', label: 'To-dos', required: false, columns: ['Status', 'Tags', 'Due Date'] },
];

const isSourceKey = (v: unknown): v is SourceKey => SOURCES.some((s) => s.key === v);

/* ---------- Notion API ---------- */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function notion(token: string, path: string, body?: Json): Promise<Json> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(apiBase() + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': NOTION_VERSION,
          'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new HttpError(502, 'Could not reach Notion. Try again.');
    }
    if (res.status === 429 && attempt < 3) {
      const wait = Math.min(5, Number(res.headers.get('retry-after')) || 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as Json;
    if (res.ok) return data;
    if (res.status === 401) {
      throw new HttpError(400, 'Notion did not accept that token. Copy the integration secret again.');
    }
    throw new HttpError(502, `Notion error: ${data.message ?? res.statusText}`);
  }
}

const plain = (rich: unknown): string =>
  Array.isArray(rich)
    ? rich
        .map((t) => t?.plain_text ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

const CURRENCY: Record<string, string> = {
  dollar: '$',
  singapore_dollar: 'S$',
  australian_dollar: 'A$',
  canadian_dollar: 'C$',
  hong_kong_dollar: 'HK$',
  new_zealand_dollar: 'NZ$',
  euro: '€',
  pound: '£',
  yen: '¥',
  yuan: '¥',
  won: '₩',
  rupee: '₹',
  ringgit: 'RM',
  baht: '฿',
  rupiah: 'Rp',
  philippine_peso: '₱',
  franc: 'CHF',
};

export interface Discovery {
  /** `id` is the Notion data source id; `props` are the property ids of the columns to fetch. */
  sources: Array<{ key: SourceKey; id: string; label: string; props: string[] }>;
  currency: string | null;
}

/** Find the databases this integration can see and match them to the tables we need. */
export async function discover(token: string): Promise<Discovery> {
  const found = new Map<string, Json[]>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await notion(token, '/v1/search', {
      filter: { property: 'object', value: 'data_source' },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const db of page.results ?? []) {
      // Skip pages, trashed databases, and ones the integration can only partly see (no title).
      if (db?.object !== 'data_source' || db.archived || db.in_trash || !Array.isArray(db.title)) continue;
      if (seen.has(db.id)) continue;
      seen.add(db.id);
      const title = plain(db.title).toLowerCase();
      found.set(title, [...(found.get(title) ?? []), db]);
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);

  const sources: Discovery['sources'] = [];
  const missing: string[] = [];
  let currency: string | null = null;
  for (const source of SOURCES) {
    const matches = found.get(source.title.toLowerCase()) ?? [];
    if (matches.length > 1) {
      throw new HttpError(
        400,
        `Found ${matches.length} databases named "${source.title}". Connect the integration to the "My Finance" page only (remove it from other copies), then try again.`,
      );
    }
    if (!matches.length) {
      if (source.required) missing.push(source.title);
      continue;
    }
    const schema = Object.entries((matches[0].properties ?? {}) as Record<string, Json>);
    const wanted = new Set(source.columns.map(norm));
    const props = schema
      .filter(([name, p]) => p?.type === 'title' || wanted.has(norm(name)))
      .map(([, p]) => p?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    sources.push({ key: source.key, id: matches[0].id, label: source.label, props });
    if (source.key === 'expenses') {
      const amount = schema.find(([name]) => norm(name) === 'amount')?.[1];
      currency = CURRENCY[amount?.number?.format] ?? null;
    }
  }
  if (missing.length) {
    throw new HttpError(
      400,
      `Could not find: ${missing.join(', ')}. In Notion, open the "My Finance" page → ••• → Connections, add your integration, then try again.`,
    );
  }
  return { sources, currency };
}

/* ---------- Mapping Notion pages to rows ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

class Props {
  private map = new Map<string, Json>();
  private titleProp: Json | undefined;
  constructor(page: Json) {
    for (const [name, value] of Object.entries(page.properties ?? {})) {
      const prop = value as Json;
      this.map.set(norm(name), prop);
      if (prop?.type === 'title') this.titleProp = prop;
    }
  }
  private get(name: string): Json | undefined {
    return this.map.get(norm(name));
  }
  /** The page title, whatever its column is called. */
  title(): string {
    return plain(this.titleProp?.title);
  }
  text(name: string): string {
    return plain(this.get(name)?.rich_text);
  }
  number(name: string): number | null {
    const n = this.get(name)?.number;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }
  checkbox(name: string): boolean {
    return this.get(name)?.checkbox === true;
  }
  select(name: string): string {
    const p = this.get(name);
    return String(p?.select?.name ?? p?.status?.name ?? '').toLowerCase();
  }
  relation(name: string): string | null {
    return this.get(name)?.relation?.[0]?.id ?? null;
  }
  hasRelation(name: string): boolean | null {
    const p = this.get(name);
    return p ? (p.relation?.length ?? 0) > 0 : null;
  }
  /** A date property as an ISO timestamp (date-only values become midday UTC). */
  timestamp(name: string): string | null {
    const start = this.get(name)?.date?.start;
    if (typeof start !== 'string') return null;
    const d = new Date(start.length === 10 ? `${start}T12:00:00Z` : start);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  day(name: string): string | null {
    const start = this.get(name)?.date?.start;
    return typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : null;
  }
}

const KIND_BY_NAME: Array<[RegExp, string]> = [
  [/liquid/i, 'liquid'],
  [/invest/i, 'investment'],
  [/physical/i, 'physical'],
  [/short/i, 'short'],
  [/med/i, 'medium'],
  [/long/i, 'long'],
];

const PAYMENT_TYPE: Record<string, string> = {
  'bank account': 'bank',
  'e wallet': 'ewallet',
  'e-wallet': 'ewallet',
  'credit card': 'card',
  cash: 'cash',
};

const INCOME_TYPE: Record<string, string> = {
  income: 'income',
  transfer: 'transfer',
  'card payment': 'card_payment',
  reimbursement: 'reimbursement',
};

const TODO_STATUS: Record<string, string> = {
  'not started': 'not_started',
  'in progress': 'in_progress',
  done: 'done',
};

type RowOp = { table: TableName; id: string; data: Record<string, unknown> };

/** Convert one Notion page into a row. Returns null for rows that should be skipped. */
export function mapPage(key: SourceKey, page: Json): RowOp | null {
  const p = new Props(page);
  const id: string = page.id;
  const name = p.title();
  const created = page.created_time ?? new Date().toISOString();

  switch (key) {
    case 'assetCategories': {
      if (!name) return null;
      const type = p.select('Type').startsWith('liab') ? 'liability' : 'asset';
      const kind = KIND_BY_NAME.find(([re]) => re.test(name))?.[1] ?? 'other';
      return { table: 'assetCategories', id, data: { name, type, kind } };
    }
    case 'accounts': {
      if (!name) return null;
      return {
        table: 'accounts',
        id,
        data: {
          name,
          type: p.select('Type').startsWith('liab') ? 'liability' : 'asset',
          categoryId: p.relation('Category'),
          initialValue: p.number('Initial Value') ?? 0,
          purchasedDate: p.day('Purchased Date'),
          // Counted in net worth when linked to the overview (or when that link does not exist).
          inNetWorth: p.hasRelation('Net Worth Overview') ?? true,
        },
      };
    }
    case 'paymentMethods': {
      if (!name) return null;
      return {
        table: 'paymentMethods',
        id,
        data: { name, type: PAYMENT_TYPE[p.select('Type')] ?? 'bank', accountId: p.relation('Link to Asset') },
      };
    }
    case 'expenseCategories': {
      if (!name) return null;
      return { table: 'expenseCategories', id, data: { name, budgetLimit: p.number('Limit') ?? 0 } };
    }
    case 'incomeCategories': {
      if (!name) return null;
      return {
        table: 'incomeCategories',
        id,
        data: { name, type: INCOME_TYPE[p.select('Type')] ?? 'income', target: p.number('Target') ?? 0 },
      };
    }
    case 'expenses': {
      const spread = p.number('Spread (months)');
      return {
        table: 'expenses',
        id,
        data: {
          name,
          amount: p.number('Amount') ?? 0,
          date: p.timestamp('Date') ?? created,
          categoryId: p.relation('Category'),
          paymentMethodId: p.relation('Account (-)'),
          targetAccountId: p.relation('Target Asset (+)'),
          myShare: p.number('My Share'),
          splitWith: p.text('Split with'),
          spreadMonths: spread && spread > 1 ? Math.floor(spread) : null,
          exclude: p.checkbox("Don't Include"),
          createdAt: created,
          source: 'notion',
        },
      };
    }
    case 'incomes': {
      return {
        table: 'incomes',
        id,
        data: {
          name,
          amount: p.number('Amount') ?? 0,
          date: p.timestamp('Date') ?? created,
          categoryId: p.relation('Category'),
          paymentMethodId: p.relation('Account (+)'),
          sourceAccountId: p.relation('Source Asset (-)'),
          expenseId: p.relation('For Expense'),
          exclude: p.checkbox("Don't Include"),
          createdAt: created,
          source: 'notion',
        },
      };
    }
    case 'plan': {
      const target = p.number('Savings Target');
      if (name.toLowerCase() !== 'this month' || target === null) return null;
      return { table: 'settings', id: SETTING.savingsTarget, data: { value: target } };
    }
    case 'todos': {
      if (!name) return null;
      return {
        table: 'todos',
        id,
        data: {
          name,
          status: TODO_STATUS[p.select('Status')] ?? 'not_started',
          tag: p.select('Tags') === 'reminder' ? 'reminder' : 'task',
          dueDate: p.day('Due Date'),
          createdAt: created,
        },
      };
    }
  }
}

/* ---------- Import steps ---------- */

/** Notion hands out property ids already percent-encoded; normalise so they are encoded exactly once. */
function propertyIdParam(id: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(id));
  } catch {
    return encodeURIComponent(id);
  }
}

export interface PageResult {
  next: string | null;
  count: number;
  ids: string[];
  /** Notion did not return every row in full. Rows missing from this listing must not be treated as deleted. */
  incomplete: boolean;
}

/** Read one page (up to 100 rows) of a Notion data source and upsert it. */
export async function importPage(
  token: string,
  key: unknown,
  sourceId: unknown,
  cursor: unknown,
  props: unknown = [],
): Promise<PageResult> {
  if (!isSourceKey(key)) throw new HttpError(400, 'Unknown import source.');
  if (typeof sourceId !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(sourceId)) {
    throw new HttpError(400, 'Bad database id.');
  }
  const ids = Array.isArray(props)
    ? props.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 64).slice(0, 30)
    : [];
  const path = `/v1/data_sources/${sourceId}/query`;
  const body = {
    page_size: 100,
    ...(typeof cursor === 'string' && cursor ? { start_cursor: cursor } : {}),
  };
  let page: Json;
  try {
    // Ask only for the columns we use: the workspace's formulas and rollups are slow to compute.
    const only = ids.map((id) => `filter_properties=${propertyIdParam(id)}`).join('&');
    page = await notion(token, only ? `${path}?${only}` : path, body);
  } catch (err) {
    if (!ids.length || !(err instanceof HttpError) || err.status !== 502) throw err;
    page = await notion(token, path, body); // Notion refused the column filter: fetch whole rows instead
  }
  // If the filter was not understood, rows come back without their columns. Never import those.
  const first = page.results?.[0];
  if (ids.length && first && Object.keys(first.properties ?? {}).length < ids.length) {
    page = await notion(token, path, body);
  }
  const pages = ((page.results ?? []) as Json[]).filter((r) => r?.object === 'page');
  // Without content access Notion returns bare { id } pages. Importing those would blank the row.
  const full = pages.filter((r) => r.properties && typeof r.properties === 'object');
  const incomplete = full.length < pages.length || page.request_status?.type === 'incomplete';
  const rows = full
    .filter((r) => !r.archived && !r.in_trash)
    .map((r) => mapPage(key, r))
    .filter((r): r is RowOp => r !== null);
  const ops: Op[] = rows.map((r) => ({ opId: '', ...r }));
  if (ops.length) await withTransaction(true, (client) => applyOps(client, ops));
  return {
    next: page.has_more ? page.next_cursor : null,
    count: rows.length,
    ids: rows.map((r) => r.id),
    incomplete,
  };
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200_000) : [];

/**
 * Wrap up an import: remove transactions that came from Notion earlier but are
 * no longer there, and fill in settings that have not been chosen yet.
 */
export async function finishImport(seen: unknown, currency: unknown): Promise<{ removed: number }> {
  const s = (seen ?? {}) as Record<string, unknown>;
  return withTransaction(true, async (client) => {
    let removed = 0;
    for (const table of ['expenses', 'incomes'] as const) {
      const ids = idList(s[table]);
      if (!ids.length) continue; // never wipe a table because a listing came back empty
      const res = await client.query(
        `update ${table} set deleted = true, rev = nextval('rev_seq'), updated_at = now()
          where source = 'notion' and not deleted and id <> all($1::text[])`,
        [ids],
      );
      removed += res.rowCount ?? 0;
    }
    const defaults: Array<[string, unknown]> = [[SETTING.fixSince, new Date().toISOString()]];
    if (typeof currency === 'string' && currency && currency.length <= 5) defaults.push([SETTING.currency, currency]);
    for (const [id, value] of defaults) {
      await client.query(
        `insert into settings (id, value, rev) values ($1, $2, nextval('rev_seq'))
         on conflict (id) do update set value = excluded.value, rev = excluded.rev, deleted = false, updated_at = now()
           where settings.deleted or settings.value is null`,
        [id, JSON.stringify(value)],
      );
    }
    return { removed };
  });
}
