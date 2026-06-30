// Types for the solution schema migration / diff tool (M1: tables + fields).
// See docs/migration-tool.md for the design.

export type MatchStatus = 'confirmed' | 'proposed' | 'ambiguous' | 'unmatched';

/** A lower→prod solution pairing. Tables/fields use names+slugs; ids regenerate per workspace. */
export interface SolutionMapping {
  name: string;
  sourceId: string | null;
  prodId: string | null;
  status: MatchStatus;
  /** When ambiguous: the candidate prod ids that share this name. */
  candidates?: string[];
}

/** A lower→prod table (application) pairing within a matched solution. */
export interface AppMapping {
  solution: string; // solution name (the matched pair's key)
  name: string;
  sourceId: string | null;
  prodId: string | null;
  status: MatchStatus;
  candidates?: string[];
}

/** Persisted per migration project: confirmed/proposed maps, reused by the diff + apply phases. */
export interface MigrationMappings {
  version: 1;
  source: { workspace: string };
  target: { workspace: string }; // = primary / production
  solutions: SolutionMapping[];
  apps: AppMapping[];
}

// ── Diff model ────────────────────────────────────────────────────────────────

export type ChangeType = 'added' | 'removed' | 'modified';
/** added/removed are structural; modified carries risk for the later apply phase. */
export type Risk = 'compatible' | 'risky';

export interface PropertyDiff {
  source: unknown;
  prod: unknown;
}

export interface FieldDiff {
  slug: string;
  label: string;
  fieldType: string;
  changeType: ChangeType;
  risk: Risk;
  /** For `modified`: per-property source vs prod (normalized, references remapped). */
  details?: Record<string, PropertyDiff>;
  /** Notes, e.g. references to tables outside the mapping that couldn't be remapped. */
  notes?: string[];
}

export type ReportKind = 'view' | 'form' | 'dashboard';

/** A view/form/dashboard diff. Matched by label within its table and kind. */
export interface ReportDiff {
  kind: ReportKind;
  label: string;
  viewMode: string;
  changeType: ChangeType;
  risk: Risk;
  /** For `modified`: changed property paths (normalized, references remapped). */
  details?: Record<string, PropertyDiff>;
  notes?: string[];
}

export interface TableDiff {
  name: string;
  status: 'matched' | 'lower-only' | 'prod-only';
  sourceId: string | null;
  prodId: string | null;
  fields: FieldDiff[];
  /** Views/forms/dashboards on this table (M2). Present only for matched tables. */
  reports?: ReportDiff[];
}

export interface SolutionDiff {
  name: string;
  sourceId: string | null;
  prodId: string | null;
  tables: TableDiff[];
}

export interface DiffSummary {
  solutions: number;
  tablesAdded: number;
  tablesRemoved: number;
  tablesMatched: number;
  fieldsAdded: number;
  fieldsModified: number;
  fieldsRemoved: number;
  reportsAdded: number;
  reportsModified: number;
  reportsRemoved: number;
  risky: number;
}

export interface SchemaDiff {
  version: 1;
  generatedAt: string;
  source: { workspace: string };
  target: { workspace: string };
  summary: DiffSummary;
  solutions: SolutionDiff[];
}
