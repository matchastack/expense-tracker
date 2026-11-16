import { login } from '@/lib/server/auth';
import { assertSameOrigin, json, readJson, route } from '@/lib/server/http';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  await login(req, body.password);
  return json({ ok: true });
});
