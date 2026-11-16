import { requireAuth } from '@/lib/server/auth';
import { assertSameOrigin, json, readJson, route } from '@/lib/server/http';
import { sync, validateOps } from '@/lib/server/sync';

export const maxDuration = 30;

/** Push local changes (if any) and pull everything that changed since the client's cursor. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  await requireAuth();
  const body = await readJson(req);
  const since = Number(body.since ?? 0);
  return json(await sync(since, validateOps(body.ops ?? [])));
});
