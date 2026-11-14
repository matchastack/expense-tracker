export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { 'cache-control': 'no-store', ...init?.headers } });

/** Wrap a route handler so thrown errors become JSON responses. */
export function route(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      console.error(err);
      return json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.');
  return body as Record<string, unknown>;
}

/**
 * Reject cross-site POSTs. Browsers send Origin on every cross-origin request,
 * so a mismatch means the request did not come from this app.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Bad origin.');
  }
  if (originHost !== host) throw new HttpError(403, 'Cross-site request refused.');
}
