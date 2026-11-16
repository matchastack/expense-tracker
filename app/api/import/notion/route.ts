import { requireAuth } from '@/lib/server/auth';
import { HttpError, assertSameOrigin, json, readJson, route } from '@/lib/server/http';
import { discover, finishImport, importPage } from '@/lib/server/notion';

export const maxDuration = 60;

/**
 * The import is driven by the browser in small steps so that no single request
 * runs long: discover the databases, then one request per 100 rows, then finish.
 * The Notion token is only used for the request it arrives with; it is never stored.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  await requireAuth();
  const body = await readJson(req);
  if (body.step === 'finish') return json(await finishImport(body.seen, body.currency));

  const token = body.token;
  if (typeof token !== 'string' || token.length < 20 || token.length > 300) {
    throw new HttpError(400, 'Paste your Notion integration secret.');
  }
  if (body.step === 'discover') return json(await discover(token));
  if (body.step === 'page') return json(await importPage(token, body.key, body.sourceId, body.cursor, body.props));
  throw new HttpError(400, 'Unknown step.');
});
