import { logout } from '@/lib/server/auth';
import { assertSameOrigin, json, route } from '@/lib/server/http';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await logout();
  return json({ ok: true });
});
