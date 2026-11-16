import { createHash } from 'node:crypto';
import { Pool, types, type PoolClient } from 'pg';
import { TABLES, TABLE_NAMES, snake, type ColSpec } from '../schema';
import { HttpError } from './http';

// Return plain values that survive JSON: dates as written, numerics as numbers.
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
types.setTypeParser(20, (v) => Number(v)); // bigint (revisions stay far below 2^53)

const globals = globalThis as unknown as { __mfPool?: Pool; __mfSchema?: Promise<void> };

export function getPool(): Pool {
  if (!globals.__mfPool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new HttpError(503, 'DATABASE_URL is not set on the server.');
    globals.__mfPool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 });
    globals.__mfPool.on('error', (err) => console.error('pg pool error', err));
  }
  return globals.__mfPool;
}

const SQL_TYPE: Record<ColSpec['type'], string> = {
  text: 'text',
  num: 'numeric(14,2)',
  int: 'integer',
  bool: 'boolean',
  ts: 'timestamptz',
  date: 'date',
  json: 'jsonb',
};

function columnDdl(spec: ColSpec): string {
  let ddl = SQL_TYPE[spec.type];
  if (spec.nullable) return ddl;
  if (spec.type === 'ts') ddl += ' not null default now()';
  else if (spec.def !== undefined) {
    const def = typeof spec.def === 'string' ? `'${spec.def.replace(/'/g, "''")}'` : String(spec.def);
    ddl += ` not null default ${def}`;
  }
  return ddl;
}

/** Idempotent DDL: safe to run on an empty database or on top of an older schema. */
export function schemaSql(): string {
  const out: string[] = ['create sequence if not exists rev_seq;'];
  for (const table of TABLE_NAMES) {
    const t = snake(table);
    out.push(
      `create table if not exists ${t} (id text primary key, rev bigint not null default 0, deleted boolean not null default false, updated_at timestamptz not null default now());`,
    );
    for (const [col, spec] of Object.entries(TABLES[table] as Record<string, ColSpec>)) {
      out.push(`alter table ${t} add column if not exists ${snake(col)} ${columnDdl(spec)};`);
    }
    out.push(`create index if not exists ${t}_rev_idx on ${t} (rev);`);
  }
  out.push(
    'create table if not exists auth_attempts (id bigserial primary key, ip text not null, at timestamptz not null default now());',
    'create index if not exists auth_attempts_at_idx on auth_attempts (at);',
    'create table if not exists meta (key text primary key, value text not null);',
  );
  return out.join('\n');
}

async function migrate(): Promise<void> {
  const pool = getPool();
  const ddl = schemaSql();
  const version = createHash('sha256').update(ddl).digest('hex').slice(0, 16);
  try {
    const cur = await pool.query("select value from meta where key = 'schema'");
    if (cur.rows[0]?.value === version) return;
  } catch (err) {
    // 42P01 = the meta table does not exist yet (fresh database).
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(7231001)');
    await client.query(ddl);
    await client.query(
      "insert into meta (key, value) values ('schema', $1) on conflict (key) do update set value = excluded.value",
      [version],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Make sure the tables exist. Runs at most once per server instance. */
export function ensureSchema(): Promise<void> {
  if (!globals.__mfSchema) {
    globals.__mfSchema = migrate().catch((err) => {
      globals.__mfSchema = undefined;
      throw err;
    });
  }
  return globals.__mfSchema;
}

/** Run `fn` in a transaction. Writers are serialised so revisions commit in order. */
export async function withTransaction<T>(write: boolean, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    if (write) await client.query('select pg_advisory_xact_lock(7231002)');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
