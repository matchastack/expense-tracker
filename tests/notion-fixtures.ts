/** Builders for objects shaped like Notion's REST API (version 2022-06-28). */

const rich = (text: string) => (text ? [{ type: 'text', plain_text: text, text: { content: text } }] : []);

export const prop = {
  title: (text: string) => ({ id: 'title', type: 'title', title: rich(text) }),
  text: (text: string) => ({ type: 'rich_text', rich_text: rich(text) }),
  number: (n: number | null) => ({ type: 'number', number: n }),
  checkbox: (v: boolean) => ({ type: 'checkbox', checkbox: v }),
  select: (name: string | null) => ({ type: 'select', select: name ? { id: 'x', name, color: 'default' } : null }),
  status: (name: string) => ({ type: 'status', status: { id: 'x', name, color: 'default' } }),
  date: (start: string) => ({ type: 'date', date: { start, end: null, time_zone: null } }),
  relation: (...ids: string[]) => ({ type: 'relation', relation: ids.map((id) => ({ id })), has_more: false }),
};

export function notionPage(id: string, properties: Record<string, unknown>, created = '2026-10-12T23:28:01.000Z') {
  return {
    object: 'page',
    id,
    created_time: created,
    last_edited_time: created,
    archived: false,
    in_trash: false,
    properties,
  };
}

export function notionDatabase(id: string, title: string, properties: Record<string, unknown> = {}) {
  return { object: 'database', id, title: rich(title), archived: false, in_trash: false, properties };
}
