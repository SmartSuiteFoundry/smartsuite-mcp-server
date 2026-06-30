import { FieldDefinition } from '../types/smartsuite.js';

/**
 * Field-param keys dropped before comparison: derived/volatile values that differ by definition
 * and are not authored schema. (Object ids, app ids, and timestamps don't appear inside field
 * params; cross-references are *remapped* below, not ignored.)
 */
export const IGNORE_FIELD_PARAM_KEYS = new Set<string>([
  'score', // formula: SmartSuite's native complexity score (derived)
  'valid', // formula: computed validity (derived)
]);

/** Param keys whose value is another application's id — remapped source→prod before comparing. */
const REMAP_KEYS = new Set<string>(['linked_application']);

/**
 * Param keys holding rich text (ProseMirror) stored as `{ data, html, preview }`. Only `data` is
 * authored; `html`/`preview` are derived render caches that serialize inconsistently across
 * workspaces. Reduce to `data` so empty/identical docs don't read as modified.
 */
const RICH_TEXT_KEYS = new Set<string>(['help_doc']);

const APP_ID_RE = /^[0-9a-f]{24}$/i;

export interface NormalizedField {
  label: string;
  fieldType: string;
  params: Record<string, unknown>;
}

/**
 * Recursively normalize a value: remap reference ids (any key in `remapKeys`) via the source→prod
 * map, and reduce rich-text keys to their authored `data`. Notes accumulate ids absent from the map.
 */
function deepNormalize(
  value: unknown,
  idMap: Map<string, string>,
  notes: Set<string>,
  remapKeys: Set<string>,
  richTextKeys: Set<string>,
): unknown {
  if (Array.isArray(value)) return value.map((v) => deepNormalize(v, idMap, notes, remapKeys, richTextKeys));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (remapKeys.has(k) && typeof v === 'string') {
        const mapped = idMap.get(v);
        if (mapped) out[k] = mapped;
        else {
          if (APP_ID_RE.test(v)) notes.add(`references ${v} outside the mapping`);
          out[k] = v;
        }
      } else if (richTextKeys.has(k) && v && typeof v === 'object') {
        out[k] = (v as Record<string, unknown>)['data'] ?? null;
      } else {
        out[k] = deepNormalize(v, idMap, notes, remapKeys, richTextKeys);
      }
    }
    return out;
  }
  return value;
}

const remapRefs = (value: unknown, appIdMap: Map<string, string>, notes: Set<string>): unknown =>
  deepNormalize(value, appIdMap, notes, REMAP_KEYS, RICH_TEXT_KEYS);

// ── Reports (views / forms / dashboards) ──────────────────────────────────────

/** Report keys remapped at any depth (workspace-specific ids → prod via the combined id map). */
export const REPORT_REMAP_KEYS = new Set<string>(['application', 'solution']);

/** Report top-level keys that are system/identity/positional noise (dropped before comparing). */
export const REPORT_TOP_IGNORE = new Set<string>([
  'id', 'owner', 'private_member', 'order', 'autosave', 'is_locked', 'parent_folder',
  'permissions', 'document', 'sharing_hash', 'sharing_password', 'is_password_protected',
  'first_created', 'last_updated', 'created_on', 'updated_on',
]);

/**
 * Canonical, comparable view of a report (view/form/dashboard): system/identity keys dropped at the
 * top level, app/solution references remapped (source→prod), rich text reduced to `data`. Pass an
 * empty map for the prod side. Field references inside `state`/`form_state` are slugs (stable) and
 * compare directly.
 */
export function normalizeReport(
  report: Record<string, unknown>,
  idMap: Map<string, string>,
  notes: Set<string>,
  extraTopIgnore: Set<string> = new Set(),
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(report)) {
    if (REPORT_TOP_IGNORE.has(k) || extraTopIgnore.has(k)) continue;
    filtered[k] = v;
  }
  return deepNormalize(filtered, idMap, notes, REPORT_REMAP_KEYS, RICH_TEXT_KEYS) as Record<string, unknown>;
}

/**
 * Canonical, comparable view of a field: label + type + params with derived keys stripped and
 * app-id references remapped (source→prod). Pass an empty map for the prod side (its ids are the
 * target). Reference notes (unmapped tables) accumulate into `notes`.
 */
export function normalizeField(
  field: FieldDefinition,
  appIdMap: Map<string, string>,
  notes: Set<string>,
): NormalizedField {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(field.params ?? {})) {
    if (IGNORE_FIELD_PARAM_KEYS.has(k)) continue;
    filtered[k] = v;
  }
  // Run the remap over the whole object so key context (e.g. `linked_application`) is preserved.
  const params = remapRefs(filtered, appIdMap, notes) as Record<string, unknown>;
  return { label: field.label, fieldType: field.field_type, params };
}
