import type { PoolClient } from 'pg';
import {
  TABLES,
  TABLE_NAMES,
  isTableName,
  snake,
  type ColSpec,
  type Op,
  type SyncResponse,
  type TableName,
} from '../schema';
import { withTransaction } from './db';
import { HttpError } from './http';

const MAX_OPS = 2000;
const MAX_TEXT = 2000;

function coerce(table: string, col: string, spec: ColSpec, value: unknown): unknown {
  const bad = () => new HttpError(400, `Invalid value for ${table}.${col}`);
  if (value === null || value === undefined) {
    if (spec.nullable) return null;
    if (spec.type === 'ts') return new Date().toISOString();
    return spec.def ?? null;
  }
  switch (spec.type) {
    case 'text': {
      if (typeof value !== 'string') throw bad();
      if (spec.oneOf && !spec.oneOf.includes(value)) throw bad();
      return value.slice(0, MAX_TEXT);
    }
    case 'num': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= 1e12) throw bad();
      return Math.round(n * 100) / 100;
    }
    case 'int': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > 1e9) throw bad();
      return n;
    }
    case 'bool':
      if (typeof value !== 'boolean') throw bad();
      return value;
    case 'ts': {
      if (typeof value !== 'string') throw bad();
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw bad();
      return d.toISOString();
    }
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad();
      return value;
    case 'json': {
      const s = JSON.stringify(value);
      if (s.length > 20_000) throw bad();
      return s;
    }
  }
}

export function validateOps(input: unknown): Op[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'ops must be an array.');
  if (input.length > MAX_OPS) throw new HttpError(413, 'Too many changes in one request.');
  return input.map((raw) => {
    const op = raw as Partial<Op>;
    if (!op || typeof op !== 'object' || !isTableName(op.table)) throw new HttpError(400, 'Unknown table.');
    if (typeof op.id !== 'string' || !op.id || op.id.length > 100) throw new HttpError(400, 'Bad row id.');
    if (op.data !== null && (typeof op.data !== 'object' || Array.isArray(op.data))) {
      throw new HttpError(400, 'Bad row data.');
    }
    return { opId: String(op.opId ?? ''), table: op.table, id: op.id, data: op.data ?? null };
  });
}

/** Apply changes in order. Last write wins per row. Must run inside a write transaction. */
export async function applyOps(client: PoolClient, ops: Op[]): Promise<void> {
  for (const op of ops) {
    const t = snake(op.table);
    if (op.data === null) {
      await client.query(
        `update ${t} set deleted = true, rev = nextval('rev_seq'), updated_at = now() where id = $1 and not deleted`,
        [op.id],
      );
      continue;
    }
    const specs = TABLES[op.table] as Record<string, ColSpec>;
    const cols: string[] = [];
    const values: unknown[] = [op.id];
    for (const [col, spec] of Object.entries(specs)) {
      if (!(col in op.data)) continue;
      cols.push(snake(col));
      values.push(coerce(op.table, col, spec, op.data[col]));
    }
    const names = ['id', ...cols, 'rev', 'deleted', 'updated_at'].join(', ');
    const params = ['$1', ...cols.map((_, i) => `$${i + 2}`), "nextval('rev_seq')", 'false', 'now()'].join(', ');
    const updates = [...cols, 'rev', 'deleted', 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ');
    await client.query(
      `insert into ${t} (${names}) values (${params}) on conflict (id) do update set ${updates}`,
      values,
    );
  }
}

function toRow(table: TableName, db: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = { id: db.id };
  if (db.deleted) {
    row.deleted = true;
    return row;
  }
  for (const col of Object.keys(TABLES[table])) row[col] = db[snake(col)];
  return row;
}

/** Everything that changed after revision `since`, including tombstones. */
export async function readChanges(client: PoolClient, since: number): Promise<SyncResponse> {
  if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, 'Bad cursor.');
  // `since` is a validated integer, so it is safe to inline: one round trip for all tables.
  const sql = TABLE_NAMES.map((t) => `select * from ${snake(t)} where rev > ${since} order by rev`).join(';\n');
  const results = (await client.query(sql)) as unknown as Array<{ rows: Record<string, unknown>[] }>;
  const list = Array.isArray(results) ? results : [results];
  const response: SyncResponse = { cursor: since, rows: {} };
  TABLE_NAMES.forEach((table, i) => {
    const rows = list[i]?.rows ?? [];
    if (!rows.length) return;
    response.rows[table] = rows.map((r) => toRow(table, r));
    response.cursor = Math.max(response.cursor, Number(rows[rows.length - 1].rev));
  });
  return response;
}

export async function sync(since: number, ops: Op[]): Promise<SyncResponse> {
  return withTransaction(ops.length > 0, async (client) => {
    if (ops.length) await applyOps(client, ops);
    return readChanges(client, since);
  });
}
