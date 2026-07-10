import { describe, it, expect } from 'vitest';
import { toCompactTable, readFormat } from '../../src/utils/format.js';

describe('toCompactTable', () => {
  const items = [
    { id: 'r1', title: 'A', fields: { status: 'open', points: 3 } },
    { id: 'r2', title: 'B', fields: { status: 'done' } },
  ];

  it('emits top keys then the union of field slugs as columns', () => {
    const t = toCompactTable(items);
    expect(t.format).toBe('compact');
    expect(t.columns).toEqual(['id', 'title', 'status', 'points']);
  });

  it('aligns rows to columns, filling null for absent fields', () => {
    const t = toCompactTable(items);
    expect(t.rows[0]).toEqual(['r1', 'A', 'open', 3]);
    expect(t.rows[1]).toEqual(['r2', 'B', 'done', null]);
  });

  it('is losslessly reconstructable for scalar values', () => {
    const t = toCompactTable(items);
    const rebuilt = t.rows.map((row) => Object.fromEntries(t.columns.map((c, i) => [c, row[i]])));
    expect(rebuilt[0]).toEqual({ id: 'r1', title: 'A', status: 'open', points: 3 });
  });

  it('is materially smaller than the JSON array for repeated fields', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, title: `T${i}`, fields: { status: 'open', priority: 'high', owner: 'x' } }));
    const jsonSize = JSON.stringify(many).length;
    const compactSize = JSON.stringify(toCompactTable(many)).length;
    expect(compactSize).toBeLessThan(jsonSize * 0.7);
  });

  it('omits top-level columns that no item has', () => {
    const t = toCompactTable([{ id: 'r1', fields: {} }]);
    expect(t.columns).toEqual(['id']);
  });
});

describe('readFormat', () => {
  it('defaults to json and only accepts compact', () => {
    expect(readFormat({})).toBe('json');
    expect(readFormat({ format: 'compact' })).toBe('compact');
    expect(readFormat({ format: 'weird' })).toBe('json');
  });
});
