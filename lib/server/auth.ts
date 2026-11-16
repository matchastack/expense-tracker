import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { ensureSchema, getPool } from './db';
import { HttpError } from './http';

const COOKIE = 'mf_session';
const SESSION_DAYS = 365;
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_IP = 8;
const MAX_FAILURES_TOTAL = 60;

const password = () => process.env.APP_PASSWORD ?? '';
const sha = (s: string) => createHash('sha256').update(s).digest();

/** Without a password the app is open in development and refuses to run in production. */
export function authDisabled(): boolean {
  if (password()) return false;
  if (process.env.NODE_ENV === 'production') {
    throw new HttpError(503, 'APP_PASSWORD is not set on the server.');
  }
  return true;
}

function secret(): Buffer {
  // Derived from the password by default, so changing the password signs everyone out.
  return sha(process.env.SESSION_SECRET || `mf:${password()}:${process.env.DATABASE_URL ?? ''}`);
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payload: string) => b64(createHmac('sha256', secret()).update(payload).digest());

function makeToken(): string {
  const payload = b64(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86_400_000 }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export async function requireAuth(): Promise<void> {
  if (authDisabled()) return;
  const jar = await cookies();
  if (!verifyToken(jar.get(COOKIE)?.value)) throw new HttpError(401, 'Sign in required.');
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

export async function login(req: Request, given: unknown): Promise<void> {
  if (authDisabled()) return;
  if (typeof given !== 'string' || !given) throw new HttpError(400, 'Enter the password.');

  await ensureSchema();
  const pool = getPool();
  const ip = clientIp(req);
  const recent = await pool.query(
    `select count(*) filter (where ip = $1)::int as mine, count(*)::int as total
       from auth_attempts where at > now() - make_interval(mins => $2)`,
    [ip, WINDOW_MINUTES],
  );
  if (recent.rows[0].mine >= MAX_FAILURES_PER_IP || recent.rows[0].total >= MAX_FAILURES_TOTAL) {
    throw new HttpError(429, `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  }

  if (!timingSafeEqual(sha(given), sha(password()))) {
    await pool.query('insert into auth_attempts (ip) values ($1)', [ip]);
    await pool.query("delete from auth_attempts where at < now() - interval '1 day'");
    throw new HttpError(401, 'Wrong password.');
  }

  const jar = await cookies();
  jar.set(COOKIE, makeToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
