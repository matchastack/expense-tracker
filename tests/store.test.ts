import { describe, expect, it } from 'vitest';
import { emptyTables, type Op } from '@/lib/schema';
import { applyLocalOps, mergeServerRows } from '@/lib/store';

const op = (table: Op['table'], id: string, data: Op['data']): Op => ({ opId: id + Math.random(), table, id, data });

describe('local store merging', () => {
  it('applies local changes without mutating the previous tables', () => {
    const before = emptyTables();
    const after = applyLocalOps(before, [
      op('todos', 't1', { name: 'pay tax', status: 'not_started' }),
      op('todos', 't2', { name: 'renew card' }),
      op('todos', 't2', null),
    ]);
    expect(before.todos).toEqual({});
    expect(Object.keys(after.todos)).toEqual(['t1']);
    expect(after.todos.t1).toMatchObject({ id: 't1', name: 'pay tax' });
    expect(after.expenses).toBe(before.expenses); // untouched tables keep their identity
  });

  it('lets the server win, drops tombstones and keeps unsent local changes on top', () => {
    let tables = applyLocalOps(emptyTables(), [
      op('todos', 'a', { name: 'local a' }),
      op('todos', 'b', { name: 'local b' }),
      op('todos', 'c', { name: 'local c' }),
    ]);
    tables = mergeServerRows(tables, {
      todos: [
        { id: 'a', name: 'server a' },
        { id: 'b', deleted: true },
      ],
    });
    expect(tables.todos.a.name).toBe('server a');
    expect(tables.todos.b).toBeUndefined();
    expect(tables.todos.c.name).toBe('local c');

    const pending = [op('todos', 'a', { name: 'edited while syncing' })];
    expect(applyLocalOps(tables, pending).todos.a.name).toBe('edited while syncing');
  });

  it('ignores tables it does not know', () => {
    const tables = mergeServerRows(emptyTables(), { nope: [{ id: 'x' }] } as never);
    expect(Object.keys(tables)).toEqual(Object.keys(emptyTables()));
  });
});
