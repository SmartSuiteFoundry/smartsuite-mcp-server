import { describe, it, expect } from 'vitest';
import { _internal, buildMyWorkPatch } from '../../src/tools/mywork.js';

const { slim, summarize, truncate, dueDateOf } = _internal;

// Anchored "now" so overdue logic is deterministic.
const NOW = new Date('2026-06-14T00:00:00.000Z').getTime();

const commentItem = {
  id: 'a1', title: 'Dev: Reports', item_type: 'comment', status: 'Open', priority: 'high',
  solution: 'solA', application: 'appA', record_id: 'rec1', field_name: 'Comment',
  field_str_value: '@Peter test', last_updated: { on: '2025-09-01T11:44:41.269Z' }, resolved_date: null,
  due_date: { from_date: { date: null }, to_date: { date: null } },
};

const overdueRecord = {
  id: 'b2', title: 'Supported Billing Currencies', item_type: 'record', status: 'Needs Revisions', priority: null,
  solution: 'solB', application: 'appB', record_id: 'rec2', field_name: 'Product Review Status',
  field_str_value: '', last_updated: { on: '2025-11-07T16:17:29.847Z' }, resolved_date: null,
  due_date: { from_date: { date: null }, to_date: { date: '2025-01-30T00:00:00.000Z' } },
};

describe('dueDateOf', () => {
  it('reads the to_date date', () => expect(dueDateOf(overdueRecord as any)).toBe('2025-01-30T00:00:00.000Z'));
  it('is null when unset', () => expect(dueDateOf(commentItem as any)).toBeNull());
});

describe('truncate', () => {
  it('returns null for empty/non-string', () => {
    expect(truncate('')).toBeNull();
    expect(truncate(null)).toBeNull();
  });
  it('collapses whitespace and caps length', () => {
    const long = 'x '.repeat(200);
    const out = truncate(long)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(201);
  });
});

describe('slim', () => {
  it('flags an item past its due date as overdue', () => {
    const s = slim(overdueRecord as any, NOW);
    expect(s).toMatchObject({ id: 'b2', itemType: 'record', dueDate: '2025-01-30T00:00:00.000Z', overdue: true });
  });
  it('does not flag items without a due date', () => {
    expect(slim(commentItem as any, NOW).overdue).toBe(false);
  });
  it('does not flag resolved items as overdue even if past due', () => {
    const resolved = { ...overdueRecord, resolved_date: '2025-02-01T00:00:00.000Z' };
    expect(slim(resolved as any, NOW).overdue).toBe(false);
  });
});

describe('summarize', () => {
  it('tallies totals, overdue, and breakdowns', () => {
    const items = [slim(commentItem as any, NOW), slim(overdueRecord as any, NOW)];
    const s = summarize(items) as any;
    expect(s.total).toBe(2);
    expect(s.overdue).toBe(1);
    expect(s.withDueDate).toBe(1);
    expect(s.byItemType).toEqual({ comment: 1, record: 1 });
    expect(s.byPriority).toEqual({ high: 1, none: 1 });
    expect(s.bySolution).toEqual({ solA: 1, solB: 1 });
  });
});

describe('buildMyWorkPatch', () => {
  it('builds a status patch', () => {
    expect(buildMyWorkPatch({ status: 'resolved' })).toEqual({ body: { status: 'resolved' } });
  });
  it('builds a due-date patch nested under due_date.to_date', () => {
    expect(buildMyWorkPatch({ dueDate: '2026-07-01T00:00:00Z' })).toEqual({ body: { due_date: { to_date: { date: '2026-07-01T00:00:00Z' } } } });
  });
  it('clears the due date with null', () => {
    expect(buildMyWorkPatch({ dueDate: null })).toEqual({ body: { due_date: { to_date: { date: null } } } });
  });
  it('combines status and dueDate', () => {
    expect(buildMyWorkPatch({ status: 'open', dueDate: null }).body).toEqual({ status: 'open', due_date: { to_date: { date: null } } });
  });
  it('rejects an invalid status', () => {
    expect(buildMyWorkPatch({ status: 'done' }).error).toMatch(/status/);
  });
  it('rejects an unparseable due date', () => {
    expect(buildMyWorkPatch({ dueDate: 'not-a-date' }).error).toMatch(/valid date/);
  });
  it('requires at least one field', () => {
    expect(buildMyWorkPatch({}).error).toMatch(/at least one/);
  });
});
