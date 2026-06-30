import { MatchStatus } from './types.js';

export interface NamedItem {
  id: string;
  name: string;
}

export interface NameMatch {
  name: string;
  sourceId: string | null;
  prodId: string | null;
  status: MatchStatus;
  /** When ambiguous: prod ids sharing this name. */
  candidates?: string[];
}

export interface MatchResult {
  /** One entry per source item (lower env), in source order. */
  matches: NameMatch[];
  /** Prod items whose name has no source counterpart (→ removed candidates). */
  prodOnly: NamedItem[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Match source (lower) items to prod items by exact, case-insensitive name. Ids are never used
 * to match — they regenerate across workspaces. 1:1 names → `proposed`; >1 prod sharing a name →
 * `ambiguous`; no prod match → `unmatched`. Prod names absent from source are returned as prodOnly.
 */
export function matchByName(source: NamedItem[], prod: NamedItem[]): MatchResult {
  const prodByName = new Map<string, NamedItem[]>();
  for (const p of prod) {
    const k = norm(p.name);
    (prodByName.get(k) ?? prodByName.set(k, []).get(k)!).push(p);
  }

  const matches: NameMatch[] = source.map((s) => {
    const cands = prodByName.get(norm(s.name)) ?? [];
    if (cands.length === 1) {
      return { name: s.name, sourceId: s.id, prodId: cands[0].id, status: 'proposed' as MatchStatus };
    }
    if (cands.length === 0) {
      return { name: s.name, sourceId: s.id, prodId: null, status: 'unmatched' as MatchStatus };
    }
    return { name: s.name, sourceId: s.id, prodId: null, status: 'ambiguous' as MatchStatus, candidates: cands.map((c) => c.id) };
  });

  const sourceNames = new Set(source.map((s) => norm(s.name)));
  const prodOnly = prod.filter((p) => !sourceNames.has(norm(p.name)));

  return { matches, prodOnly };
}

export interface Override {
  sourceId: string;
  prodId: string;
}

/**
 * Apply manual overrides (resolving ambiguous/unmatched) and, when `confirm`, promote unambiguous
 * `proposed` matches to `confirmed`. Returns a new array; never mutates the input.
 */
export function applyConfirmations(
  matches: NameMatch[],
  opts: { confirm?: boolean; overrides?: Override[] } = {},
): NameMatch[] {
  const overrideBySource = new Map((opts.overrides ?? []).map((o) => [o.sourceId, o.prodId]));
  return matches.map((m) => {
    if (m.sourceId && overrideBySource.has(m.sourceId)) {
      return { ...m, prodId: overrideBySource.get(m.sourceId)!, status: 'confirmed' as MatchStatus, candidates: undefined };
    }
    if (opts.confirm && m.status === 'proposed') {
      return { ...m, status: 'confirmed' as MatchStatus };
    }
    return m;
  });
}
