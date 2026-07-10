// Compact tabular serialization for record lists. A JSON array of objects repeats every field name
// on every row; for large result sets that key-repetition dominates the token cost. The compact form
// emits the column names once plus a value matrix, which is materially smaller and losslessly
// reconstructable for scalar field values.

export type RecordFormat = 'json' | 'compact';

/** Top-level (non-`fields`) keys projectRecord may emit, in a stable column order. */
const TOP_KEYS = ['id', 'title', 'createdAt', 'updatedAt'];

export interface CompactTable {
  format: 'compact';
  columns: string[];
  rows: Array<Array<unknown>>;
}

/**
 * Convert projected records ({ id, title, createdAt?, updatedAt?, fields:{...} }) into a columns+rows
 * table. Columns are the present top-level keys followed by the union of field slugs across all rows;
 * a row carries `null` where it lacks a column. Order of field columns follows first appearance.
 */
export function toCompactTable(items: Array<Record<string, unknown>>): CompactTable {
  const topPresent = TOP_KEYS.filter((k) => items.some((it) => it[k] !== undefined));
  const fieldCols: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const fields = (it['fields'] as Record<string, unknown> | undefined) ?? {};
    for (const k of Object.keys(fields)) if (!seen.has(k)) { seen.add(k); fieldCols.push(k); }
  }
  const columns = [...topPresent, ...fieldCols];
  const rows = items.map((it) => {
    const fields = (it['fields'] as Record<string, unknown> | undefined) ?? {};
    return [
      ...topPresent.map((k) => it[k] ?? null),
      ...fieldCols.map((k) => (k in fields ? fields[k] : null)),
    ];
  });
  return { format: 'compact', columns, rows };
}

/** Read and validate a `format` argument, defaulting to 'json'. */
export function readFormat(args: Record<string, unknown>): RecordFormat {
  return args['format'] === 'compact' ? 'compact' : 'json';
}
