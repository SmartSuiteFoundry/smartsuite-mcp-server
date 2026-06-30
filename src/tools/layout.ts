import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';

// Record-view layout sections. A section is an entry in a mode body's `sections[]` PLUS a marker
// row in that body's `rows` (a pair `["section__slug",""]` in fifty_fifty, a flat `"section__slug"`
// in single_column). Fields belong to a section implicitly by row order. Tabs, when enabled, each
// carry their own layout; `tabId` targets one. seventy_thirty (no rows/sections array) is left as-is.

type AnyObj = Record<string, any>;

const HEX = '0123456789abcdef';
export function generateSectionSlug(): string {
  let s = '';
  for (let i = 0; i < 9; i++) s += HEX[Math.floor(Math.random() * 16)];
  return `section__s${s}`;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Build a ProseMirror section description from plain text (blank → null). Blank lines split paragraphs. */
export function buildSectionDescription(text?: string | null): unknown {
  if (!text || !text.trim()) return null;
  const paras = text.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  return {
    data: { type: 'doc', content: paras.map((p) => ({ type: 'paragraph', attrs: { textAlign: 'left', size: 'medium' }, content: [{ type: 'text', text: p }] })) },
    html: paras.map((p) => `<p>${escapeHtml(p)}</p>`).join(''),
  };
}

/** True when tabs are enabled and present — in which case the record view renders per-tab layouts, not the top-level one. */
export function tabsEnabled(layout: AnyObj): boolean {
  return layout?.tabs?.enabled === true && Array.isArray(layout?.tabs?.tabs) && layout.tabs.tabs.length > 0;
}

/** Single container for read/summary: a specific tab's layout, or the top-level layout. */
function resolveContainer(layout: AnyObj, tabId?: string): AnyObj {
  if (!tabId || tabId === 'all' || tabId === 'top') return layout;
  const tabs = layout?.tabs?.tabs;
  if (!Array.isArray(tabs)) throw new Error('This application has no tabs configured; omit tabId to edit the top-level layout.');
  const tab = tabs.find((t: AnyObj) => t.id === tabId);
  if (!tab) throw new Error(`Tab "${tabId}" not found. Available: ${tabs.map((t: AnyObj) => `${t.name}(${t.id})`).join(', ') || 'none'}.`);
  if (!tab.layout || typeof tab.layout !== 'object') tab.layout = {};
  return tab.layout;
}

/**
 * Containers to MUTATE. `tabId` semantics:
 *   - a tab id  → just that tab's layout (what that tab displays)
 *   - "all"     → top-level layout + every tab's layout
 *   - "top"     → the top-level layout only (escape hatch; not displayed when tabs are on)
 *   - omitted   → top-level layout (intended for tabs-disabled tables)
 * Throws for an unknown tab id.
 */
function resolveContainers(layout: AnyObj, tabId?: string): AnyObj[] {
  if (tabId === 'all') {
    const out: AnyObj[] = [layout];
    const tabs = layout?.tabs?.tabs;
    if (Array.isArray(tabs)) for (const t of tabs) { if (!t.layout || typeof t.layout !== 'object') t.layout = {}; out.push(t.layout); }
    return out;
  }
  if (!tabId || tabId === 'top') return [layout];
  return [resolveContainer(layout, tabId)];
}

/** Mode bodies that carry both `rows` and `sections` arrays (fifty_fifty, single_column). */
function rowSectionBodies(container: AnyObj): Array<{ key: string; body: AnyObj }> {
  const out: Array<{ key: string; body: AnyObj }> = [];
  for (const key of Object.keys(container)) {
    const body = container[key];
    if (body && typeof body === 'object' && !Array.isArray(body) && Array.isArray(body.rows) && Array.isArray(body.sections)) {
      out.push({ key, body });
    }
  }
  return out;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export interface SectionInput {
  title: string;
  slug: string;
  description?: unknown;
  collapsed?: boolean;
  hidden?: boolean;
}

/** Insert a section into every rows+sections body of the target container. Returns a new layout. */
export function addSectionToLayout(
  layout: AnyObj,
  section: SectionInput,
  opts: { afterField?: string; tabId?: string } = {},
): { layout: AnyObj; bodiesUpdated: number } {
  const next = clone(layout);
  let bodiesUpdated = 0;
  for (const container of resolveContainers(next, opts.tabId)) {
    for (const { key, body } of rowSectionBodies(container)) {
      body.sections.push({
        title: section.title,
        slug: section.slug,
        collapsed: !!section.collapsed,
        description: section.description ?? null,
        hidden: !!section.hidden,
      });
      const pairs = key !== 'single_column';
      const marker: unknown = pairs ? [section.slug, ''] : section.slug;
      let idx = -1;
      if (opts.afterField) {
        idx = body.rows.findIndex((r: unknown) =>
          pairs ? Array.isArray(r) && (r[0] === opts.afterField || r[1] === opts.afterField) : r === opts.afterField,
        );
      }
      if (idx >= 0) body.rows.splice(idx + 1, 0, marker);
      else body.rows.push(marker);
      bodiesUpdated++;
    }
  }
  return { layout: next, bodiesUpdated };
}

export interface SectionPatch {
  title?: string;
  description?: unknown; // present key = set (null clears)
  collapsed?: boolean;
  hidden?: boolean;
  setDescription?: boolean;
}

export function updateSectionInLayout(layout: AnyObj, slug: string, patch: SectionPatch, tabId?: string): { layout: AnyObj; found: boolean } {
  const next = clone(layout);
  let found = false;
  for (const container of resolveContainers(next, tabId)) {
    for (const { body } of rowSectionBodies(container)) {
      for (const sec of body.sections as AnyObj[]) {
        if (sec.slug !== slug) continue;
        found = true;
        if (patch.title !== undefined) sec.title = patch.title;
        if (patch.collapsed !== undefined) sec.collapsed = patch.collapsed;
        if (patch.hidden !== undefined) sec.hidden = patch.hidden;
        if (patch.setDescription) sec.description = patch.description ?? null;
      }
    }
  }
  return { layout: next, found };
}

export function removeSectionFromLayout(layout: AnyObj, slug: string, tabId?: string): { layout: AnyObj; found: boolean } {
  const next = clone(layout);
  let found = false;
  for (const container of resolveContainers(next, tabId)) {
    for (const { key, body } of rowSectionBodies(container)) {
      const before = body.sections.length;
      body.sections = body.sections.filter((s: AnyObj) => s.slug !== slug);
      if (body.sections.length < before) found = true;
      const pairs = key !== 'single_column';
      body.rows = body.rows.filter((r: unknown) => (pairs ? !(Array.isArray(r) && r[0] === slug) : r !== slug));
    }
  }
  return { layout: next, found };
}

/** Slim section list from the target container's first rows+sections body (for responses). */
export function sectionsOf(layout: AnyObj, tabId?: string): Array<Record<string, unknown>> {
  try {
    const bodies = rowSectionBodies(resolveContainer(layout, tabId));
    const body = bodies[0];
    if (!body) return [];
    return (body.body.sections as AnyObj[]).map((s) => ({ slug: s.slug, title: s.title, collapsed: !!s.collapsed, hidden: !!s.hidden }));
  } catch {
    return [];
  }
}

/**
 * Move an existing field within the layout: remove it from wherever it currently sits and re-insert
 * it after `afterField` (a field slug or a section__ slug, so the field lands under that section) or
 * at the end. In fifty_fifty (paired) bodies the moved field is re-inserted as its own full-width row.
 * Only bodies that already contained the field are touched. Returns a new layout.
 */
export function moveFieldInLayout(layout: AnyObj, slug: string, opts: { afterField?: string; tabId?: string } = {}): { layout: AnyObj; found: boolean } {
  const next = clone(layout);
  let found = false;
  for (const container of resolveContainers(next, opts.tabId)) {
    for (const { key, body } of rowSectionBodies(container)) {
      const pairs = key !== 'single_column';
      let removed = false;
      if (pairs) {
        for (const row of body.rows as unknown[]) {
          if (Array.isArray(row)) {
            if (row[0] === slug) { row[0] = ''; removed = true; }
            if (row[1] === slug) { row[1] = ''; removed = true; }
          }
        }
        body.rows = (body.rows as unknown[]).filter((r) => !(Array.isArray(r) && r[0] === '' && r[1] === ''));
      } else {
        const before = body.rows.length;
        body.rows = (body.rows as unknown[]).filter((r) => r !== slug);
        if (body.rows.length < before) removed = true;
      }
      if (!removed) continue; // field wasn't in this body — don't introduce it
      found = true;
      const marker: unknown = pairs ? [slug, ''] : slug;
      let idx = -1;
      if (opts.afterField) {
        idx = (body.rows as unknown[]).findIndex((r) =>
          pairs ? Array.isArray(r) && (r[0] === opts.afterField || r[1] === opts.afterField) : r === opts.afterField,
        );
      }
      if (idx >= 0) body.rows.splice(idx + 1, 0, marker);
      else body.rows.push(marker);
    }
  }
  return { layout: next, found };
}

/** Flattened slug order (fields + section markers) of the target container's first rows body — for responses. */
export function rowsOrderOf(layout: AnyObj, tabId?: string): string[] {
  const body = rowSectionBodies(resolveContainer(layout, tabId))[0]?.body;
  if (!body) return [];
  const out: string[] = [];
  for (const r of body.rows as unknown[]) {
    if (Array.isArray(r)) { for (const c of r) if (c) out.push(c as string); }
    else if (r) out.push(r as string);
  }
  return out;
}

/**
 * Hide or show a field in the record view. Hiding adds the slug to the top-level `hidden_fields`
 * array (the field stays in the layout rows; this list is the authoritative hide). Showing removes
 * it. `hidden_fields` is record-wide (not per-tab). Returns a new layout + whether anything changed.
 */
export function setFieldHidden(layout: AnyObj, slug: string, hidden: boolean): { layout: AnyObj; changed: boolean; hiddenFields: string[] } {
  const next = clone(layout);
  const cur: string[] = Array.isArray(next.hidden_fields) ? next.hidden_fields.slice() : [];
  const has = cur.includes(slug);
  let changed = false;
  if (hidden && !has) { cur.push(slug); changed = true; }
  if (!hidden && has) { cur.splice(cur.indexOf(slug), 1); changed = true; }
  next.hidden_fields = cur;
  return { layout: next, changed, hiddenFields: cur };
}

// ── Display logic (visibility conditions) ─────────────────────────────────────

export interface VisibilityCondition { comparison: string; field: string; value?: unknown }

/** Build a visibility_conditions object (the uniform shape used by fields, sections, and tabs).
 *  Each condition's `value` is normalized to be present (null when absent) — the API requires the key. */
export function buildVisibilityConditions(operator: 'and' | 'or', conditions: VisibilityCondition[], name: string): AnyObj {
  return { operator, conditions: conditions.map((c) => ({ comparison: c.comparison, field: c.field, value: c.value ?? null })), name };
}

/** Upsert (or remove when vc=null) a field's display rule in top-level fields_visibility_conditions. */
export function setFieldDisplayLogic(layout: AnyObj, fieldSlug: string, vc: AnyObj | null): { layout: AnyObj; changed: boolean } {
  const next = clone(layout);
  const before: AnyObj[] = Array.isArray(next.fields_visibility_conditions) ? next.fields_visibility_conditions : [];
  const arr = before.filter((e) => e.field_slug !== fieldSlug);
  let changed = arr.length !== before.length;
  if (vc) { arr.push({ field_slug: fieldSlug, visibility_conditions: vc }); changed = true; }
  next.fields_visibility_conditions = arr;
  return { layout: next, changed };
}

/** Set (or remove when vc=null) a tab's display rule (tab.visibility_conditions). */
export function setTabDisplayLogic(layout: AnyObj, tabId: string, vc: AnyObj | null): { layout: AnyObj; found: boolean } {
  const next = clone(layout);
  const tabs = next.tabs?.tabs;
  if (!Array.isArray(tabs)) throw new Error('This application has no tabs configured.');
  const tab = tabs.find((t: AnyObj) => t.id === tabId);
  if (!tab) throw new Error(`Tab "${tabId}" not found.`);
  if (vc) tab.visibility_conditions = vc; else delete tab.visibility_conditions;
  return { layout: next, found: true };
}

/** Set (or clear when vc=null) a section's display rule on every container (top-level + tabs) that holds it. */
export function setSectionDisplayLogic(layout: AnyObj, sectionSlug: string, vc: AnyObj | null): { layout: AnyObj; found: boolean } {
  const next = clone(layout);
  const containers: AnyObj[] = [next, ...(Array.isArray(next.tabs?.tabs) ? next.tabs.tabs.map((t: AnyObj) => t.layout).filter(Boolean) : [])];
  let found = false;
  for (const c of containers) {
    for (const { body } of rowSectionBodies(c)) {
      for (const sec of body.sections as AnyObj[]) {
        if (sec.slug === sectionSlug) { sec.visibility_conditions = vc; found = true; }
      }
    }
  }
  return { layout: next, found };
}

// ── Tabs ────────────────────────────────────────────────────────────────────

const TAB_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function generateTabId(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += TAB_ID_CHARS[Math.floor(Math.random() * TAB_ID_CHARS.length)];
  return s;
}

/** Sort tabs by position and renumber to contiguous 0..n-1. */
function reindexTabs(tabs: AnyObj[]): void {
  tabs.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  tabs.forEach((t, i) => { t.position = i; });
}

/** Copy the top-level mode bodies into a fresh tab layout (so the first tab shows existing fields). */
function mirrorContainer(layout: AnyObj): AnyObj {
  const out: AnyObj = {};
  for (const k of ['fifty_fifty', 'seventy_thirty', 'single_column']) if (layout[k]) out[k] = clone(layout[k]);
  return out;
}

export interface TabInput {
  name: string;
  description?: unknown; // built doc or null
  position?: number;
  style?: string;
  align?: string;
}

/** Append a tab. Enables tabs if needed; the very first tab mirrors the top-level layout. */
export function addTabToLayout(layout: AnyObj, opts: TabInput): { layout: AnyObj; id: string } {
  const next = clone(layout);
  if (!next.tabs || typeof next.tabs !== 'object') next.tabs = { enabled: false, style: 'basic', align: 'left', tabs: [] };
  const tabsCfg = next.tabs;
  if (!Array.isArray(tabsCfg.tabs)) tabsCfg.tabs = [];
  if (typeof opts.style === 'string') tabsCfg.style = opts.style;
  if (typeof opts.align === 'string') tabsCfg.align = opts.align;

  const existing = new Set(tabsCfg.tabs.map((t: AnyObj) => t.id));
  let id = generateTabId();
  while (existing.has(id)) id = generateTabId();

  const tab: AnyObj = { id, name: opts.name };
  if (opts.description) tab.description = opts.description;
  if (!tabsCfg.enabled && tabsCfg.tabs.length === 0) tab.layout = mirrorContainer(next); // first tab mirrors top-level
  tabsCfg.enabled = true;
  tab.position = typeof opts.position === 'number' ? opts.position - 0.5 : tabsCfg.tabs.length;
  tabsCfg.tabs.push(tab);
  reindexTabs(tabsCfg.tabs);
  return { layout: next, id };
}

export interface TabPatch {
  name?: string;
  description?: unknown;
  setDescription?: boolean;
  position?: number;
  style?: string;
  align?: string;
}

export function updateTabInLayout(layout: AnyObj, tabId: string, patch: TabPatch): { layout: AnyObj; found: boolean } {
  const next = clone(layout);
  const tabsCfg = next.tabs;
  if (!tabsCfg || !Array.isArray(tabsCfg.tabs)) throw new Error('This application has no tabs configured.');
  if (typeof patch.style === 'string') tabsCfg.style = patch.style;
  if (typeof patch.align === 'string') tabsCfg.align = patch.align;
  const tab = tabsCfg.tabs.find((t: AnyObj) => t.id === tabId);
  if (!tab) return { layout: next, found: false };
  if (patch.name !== undefined) tab.name = patch.name;
  if (patch.setDescription) tab.description = patch.description ?? null;
  if (typeof patch.position === 'number') { tab.position = patch.position - 0.5; reindexTabs(tabsCfg.tabs); }
  return { layout: next, found: true };
}

export function removeTabFromLayout(layout: AnyObj, tabId: string): { layout: AnyObj; found: boolean; disabled: boolean } {
  const next = clone(layout);
  const tabsCfg = next.tabs;
  if (!tabsCfg || !Array.isArray(tabsCfg.tabs)) return { layout: next, found: false, disabled: false };
  const before = tabsCfg.tabs.length;
  tabsCfg.tabs = tabsCfg.tabs.filter((t: AnyObj) => t.id !== tabId);
  const found = tabsCfg.tabs.length < before;
  let disabled = false;
  if (found) {
    reindexTabs(tabsCfg.tabs);
    if (tabsCfg.tabs.length === 0) { tabsCfg.enabled = false; disabled = true; }
  }
  return { layout: next, found, disabled };
}

/** Slim tab list (for responses). */
export function tabsOf(layout: AnyObj): Record<string, unknown> {
  const t = layout?.tabs;
  if (!t || !Array.isArray(t.tabs)) return { enabled: false, tabs: [] };
  return {
    enabled: !!t.enabled, style: t.style ?? null, align: t.align ?? null,
    tabs: t.tabs.slice().sort((a: AnyObj, b: AnyObj) => a.position - b.position)
      .map((x: AnyObj) => ({ id: x.id, name: x.name, position: x.position, hasLayout: !!x.layout, hasDescription: !!x.description })),
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function schemaWriteGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Layout writes are blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Layout writes are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to enable editing record-view sections.');
  }
  return null;
}

const errResult = (e: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true });
const target = (tabId?: string): string => (tabId ? (tabId === 'all' ? 'all tabs' : tabId === 'top' ? 'top-level layout' : `tab ${tabId}`) : 'top-level layout');

/**
 * When tabs are enabled the record view renders per-tab layouts, so a top-level section edit isn't
 * displayed. Require an explicit tabId in that case so we never silently write to a hidden layout.
 */
function tabSelectionGuard(layout: AnyObj, tabId?: string): ToolResult | null {
  if (!tabsEnabled(layout) || tabId) return null;
  const list = (layout.tabs.tabs as AnyObj[]).map((t) => `"${t.id}" (${t.name})`).join(', ');
  return err(
    'SMARTSUITE_VALIDATION_ERROR',
    `Tabs are enabled on this table, so a top-level section won't be displayed. Pass tabId — one of ${list} — or "all" to apply to every tab, or "top" to edit the hidden top-level layout anyway.`,
  );
}

export async function handleAddLayoutSection(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const title = args['title'] as string;
  const tabId = args['tabId'] as string | undefined;
  const afterField = args['afterField'] as string | undefined;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!title?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'title is required.');

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');
    const tabGuard = tabSelectionGuard(layout, tabId);
    if (tabGuard) return tabGuard;

    const slug = generateSectionSlug();
    const section: SectionInput = {
      title, slug,
      description: buildSectionDescription(args['description'] as string | undefined),
      collapsed: args['collapsed'] === true,
      hidden: args['hidden'] === true,
    };

    let result;
    try {
      result = addSectionToLayout(layout, section, { afterField, tabId });
    } catch (e) {
      return err('SMARTSUITE_VALIDATION_ERROR', (e as Error).message);
    }
    if (result.bodiesUpdated === 0) {
      return err('SMARTSUITE_VALIDATION_ERROR', `No layout bodies to update in ${target(tabId)} (the layout has no rows/sections — an empty tab?).`);
    }

    if (!confirm) {
      return ok({ dryRun: true, wouldAdd: { slug, title, afterField: afterField ?? '(end)' }, target: target(tabId), note: 'Re-call with confirm:true to apply.' });
    }
    const updated = await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ added: true, slug, target: target(tabId), sections: sectionsOf(updated.structure_layout as AnyObj, tabId) });
  } catch (e) {
    return errResult(e);
  }
}

export async function handleUpdateLayoutSection(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const slug = args['slug'] as string;
  const tabId = args['tabId'] as string | undefined;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!slug) return err('SMARTSUITE_VALIDATION_ERROR', 'slug is required (the section__… slug to update).');

  const patch: SectionPatch = {};
  if (typeof args['title'] === 'string') patch.title = args['title'] as string;
  if (typeof args['collapsed'] === 'boolean') patch.collapsed = args['collapsed'] as boolean;
  if (typeof args['hidden'] === 'boolean') patch.hidden = args['hidden'] as boolean;
  if ('description' in args) { patch.setDescription = true; patch.description = buildSectionDescription(args['description'] as string | undefined); }
  if (patch.title === undefined && patch.collapsed === undefined && patch.hidden === undefined && !patch.setDescription) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'Provide at least one of title, description, collapsed, hidden to update.');
  }

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');
    const tabGuard = tabSelectionGuard(layout, tabId);
    if (tabGuard) return tabGuard;

    let result;
    try {
      result = updateSectionInLayout(layout, slug, patch, tabId);
    } catch (e) {
      return err('SMARTSUITE_VALIDATION_ERROR', (e as Error).message);
    }
    if (!result.found) return err('SMARTSUITE_NOT_FOUND', `Section "${slug}" not found in ${target(tabId)}.`);

    if (!confirm) return ok({ dryRun: true, wouldUpdate: slug, changes: Object.keys(args).filter((k) => ['title', 'description', 'collapsed', 'hidden'].includes(k)), target: target(tabId), note: 'Re-call with confirm:true to apply.' });
    const updated = await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ updated: true, slug, target: target(tabId), sections: sectionsOf(updated.structure_layout as AnyObj, tabId) });
  } catch (e) {
    return errResult(e);
  }
}

export async function handleRemoveLayoutSection(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const slug = args['slug'] as string;
  const tabId = args['tabId'] as string | undefined;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!slug) return err('SMARTSUITE_VALIDATION_ERROR', 'slug is required (the section__… slug to remove).');

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');
    const tabGuard = tabSelectionGuard(layout, tabId);
    if (tabGuard) return tabGuard;

    let result;
    try {
      result = removeSectionFromLayout(layout, slug, tabId);
    } catch (e) {
      return err('SMARTSUITE_VALIDATION_ERROR', (e as Error).message);
    }
    if (!result.found) return err('SMARTSUITE_NOT_FOUND', `Section "${slug}" not found in ${target(tabId)}.`);

    if (!confirm) return ok({ dryRun: true, wouldRemove: slug, target: target(tabId), note: 'Removes the section grouping only; fields that were under it are preserved. Re-call with confirm:true to apply.' });
    const updated = await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ removed: true, slug, target: target(tabId), sections: sectionsOf(updated.structure_layout as AnyObj, tabId) });
  } catch (e) {
    return errResult(e);
  }
}

// ── Tab handlers ────────────────────────────────────────────────────────────

export async function handleAddLayoutTab(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const name = args['name'] as string;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!name?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'name is required.');

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');

    const { layout: next, id } = addTabToLayout(layout, {
      name,
      description: buildSectionDescription(args['description'] as string | undefined),
      position: typeof args['position'] === 'number' ? (args['position'] as number) : undefined,
      style: args['style'] as string | undefined,
      align: args['align'] as string | undefined,
    });

    if (!confirm) return ok({ dryRun: true, wouldAdd: { id, name }, note: 'Re-call with confirm:true to apply.', tabs: tabsOf(next) });
    const updated = await ctx.client.updateApplicationLayout(applicationId, next);
    return ok({ added: true, id, tabs: tabsOf(updated.structure_layout as AnyObj) });
  } catch (e) {
    return errResult(e);
  }
}

export async function handleUpdateLayoutTab(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const tabId = args['tabId'] as string;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!tabId) return err('SMARTSUITE_VALIDATION_ERROR', 'tabId is required.');

  const patch: TabPatch = {};
  if (typeof args['name'] === 'string') patch.name = args['name'] as string;
  if (typeof args['position'] === 'number') patch.position = args['position'] as number;
  if (typeof args['style'] === 'string') patch.style = args['style'] as string;
  if (typeof args['align'] === 'string') patch.align = args['align'] as string;
  if ('description' in args) { patch.setDescription = true; patch.description = buildSectionDescription(args['description'] as string | undefined); }
  if (patch.name === undefined && patch.position === undefined && patch.style === undefined && patch.align === undefined && !patch.setDescription) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'Provide at least one of name, description, position, style, align to update.');
  }

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');

    let result;
    try {
      result = updateTabInLayout(layout, tabId, patch);
    } catch (e) {
      return err('SMARTSUITE_VALIDATION_ERROR', (e as Error).message);
    }
    if (!result.found) return err('SMARTSUITE_NOT_FOUND', `Tab "${tabId}" not found.`);

    if (!confirm) return ok({ dryRun: true, wouldUpdate: tabId, note: 'Re-call with confirm:true to apply.', tabs: tabsOf(result.layout) });
    const updated = await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ updated: true, tabId, tabs: tabsOf(updated.structure_layout as AnyObj) });
  } catch (e) {
    return errResult(e);
  }
}

export async function handleRemoveLayoutTab(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const tabId = args['tabId'] as string;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!tabId) return err('SMARTSUITE_VALIDATION_ERROR', 'tabId is required.');

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');

    const result = removeTabFromLayout(layout, tabId);
    if (!result.found) return err('SMARTSUITE_NOT_FOUND', `Tab "${tabId}" not found.`);

    if (!confirm) {
      return ok({ dryRun: true, wouldRemove: tabId, willDisableTabs: result.disabled, note: 'Removes the tab; fields remain in the top-level layout. Re-call with confirm:true to apply.', tabs: tabsOf(result.layout) });
    }
    const updated = await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ removed: true, tabId, tabsDisabled: result.disabled, tabs: tabsOf(updated.structure_layout as AnyObj) });
  } catch (e) {
    return errResult(e);
  }
}

// ── Move field handler ────────────────────────────────────────────────────────

export async function handleMoveLayoutField(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const slug = args['slug'] as string;
  const afterField = args['afterField'] as string | undefined;
  const tabId = args['tabId'] as string | undefined;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!slug) return err('SMARTSUITE_VALIDATION_ERROR', 'slug is required (the field to move).');

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');
    const tabGuard = tabSelectionGuard(layout, tabId);
    if (tabGuard) return tabGuard;

    let result;
    try {
      result = moveFieldInLayout(layout, slug, { afterField, tabId });
    } catch (e) {
      return err('SMARTSUITE_VALIDATION_ERROR', (e as Error).message);
    }
    if (!result.found) return err('SMARTSUITE_NOT_FOUND', `Field "${slug}" is not placed in ${target(tabId)}.`);

    if (!confirm) return ok({ dryRun: true, wouldMove: slug, afterField: afterField ?? '(end)', target: target(tabId), order: rowsOrderOf(result.layout, tabId === 'all' || tabId === 'top' ? undefined : tabId), note: 'Re-call with confirm:true to apply.' });
    const updated = await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ moved: true, slug, target: target(tabId), order: rowsOrderOf(updated.structure_layout as AnyObj, tabId === 'all' || tabId === 'top' ? undefined : tabId) });
  } catch (e) {
    return errResult(e);
  }
}

// ── Field visibility (hide/show) handler ──────────────────────────────────────

export async function handleSetFieldVisibility(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const slug = args['slug'] as string;
  const hidden = args['hidden'];
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!slug) return err('SMARTSUITE_VALIDATION_ERROR', 'slug is required.');
  if (typeof hidden !== 'boolean') return err('SMARTSUITE_VALIDATION_ERROR', 'hidden is required (true = hide, false = show).');

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');
    if (!(app.structure ?? []).some((f) => f.slug === slug)) return err('SMARTSUITE_NOT_FOUND', `Field "${slug}" not found in application ${applicationId}.`);

    const { layout: next, changed, hiddenFields } = setFieldHidden(layout, slug, hidden);
    if (!changed) return ok({ slug, hidden, hiddenFields, note: `Field is already ${hidden ? 'hidden' : 'visible'}.` });
    if (!confirm) return ok({ dryRun: true, would: { slug, hidden }, hiddenFields, note: 'Re-call with confirm:true to apply.' });

    const updated = await ctx.client.updateApplicationLayout(applicationId, next);
    return ok({ slug, hidden, hiddenFields: (updated.structure_layout as AnyObj)?.hidden_fields ?? hiddenFields });
  } catch (e) {
    return errResult(e);
  }
}

// ── Display logic handler (field / section / tab) ─────────────────────────────

export async function handleSetDisplayLogic(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const targetType = args['target'] as string; // 'field' | 'section' | 'tab'
  const targetId = args['targetId'] as string;
  const operator = (args['operator'] as string) === 'or' ? 'or' : 'and';
  const conditions = Array.isArray(args['conditions']) ? (args['conditions'] as VisibilityCondition[]) : undefined;
  const clear = args['clear'] === true;
  const confirm = args['confirm'] === true;

  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!['field', 'section', 'tab'].includes(targetType)) return err('SMARTSUITE_VALIDATION_ERROR', 'target must be "field", "section", or "tab".');
  if (!targetId) return err('SMARTSUITE_VALIDATION_ERROR', 'targetId is required (field slug, section__ slug, or tab id).');
  if (!clear && (!conditions || conditions.length === 0)) return err('SMARTSUITE_VALIDATION_ERROR', 'Provide conditions (a non-empty array of {comparison, field, value}) or clear:true to remove the rule.');
  if (!clear) {
    for (const c of conditions!) {
      if (!c || typeof c.comparison !== 'string' || typeof c.field !== 'string') return err('SMARTSUITE_VALIDATION_ERROR', 'Each condition needs {comparison, field, value?}.');
    }
  }

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh: true });
    const layout = app.structure_layout as AnyObj | undefined;
    if (!layout) return err('SMARTSUITE_VALIDATION_ERROR', 'This application has no structure_layout to edit.');

    // Resolve the target's display name (label/title/name) for the rule.
    let name: string | undefined;
    if (targetType === 'field') name = (app.structure ?? []).find((f) => f.slug === targetId)?.label;
    else if (targetType === 'tab') name = (layout.tabs?.tabs as AnyObj[] | undefined)?.find((t) => t.id === targetId)?.name;
    else {
      const containers: AnyObj[] = [layout, ...(Array.isArray(layout.tabs?.tabs) ? layout.tabs.tabs.map((t: AnyObj) => t.layout).filter(Boolean) : [])];
      for (const c of containers) for (const { body } of rowSectionBodies(c)) { const s = (body.sections as AnyObj[]).find((x) => x.slug === targetId); if (s) name = s.title; }
    }
    if (name === undefined) return err('SMARTSUITE_NOT_FOUND', `${targetType} "${targetId}" not found in application ${applicationId}.`);

    const vc = clear ? null : buildVisibilityConditions(operator, conditions!, name);

    let result: { layout: AnyObj; found?: boolean; changed?: boolean };
    try {
      if (targetType === 'field') result = setFieldDisplayLogic(layout, targetId, vc);
      else if (targetType === 'tab') result = setTabDisplayLogic(layout, targetId, vc);
      else result = setSectionDisplayLogic(layout, targetId, vc);
    } catch (e) {
      return err('SMARTSUITE_VALIDATION_ERROR', (e as Error).message);
    }
    if (result.found === false) return err('SMARTSUITE_NOT_FOUND', `${targetType} "${targetId}" not found.`);

    const summary = { target: targetType, targetId, rule: clear ? null : vc };
    if (!confirm) return ok({ dryRun: true, would: summary, note: 'Re-call with confirm:true to apply.' });
    await ctx.client.updateApplicationLayout(applicationId, result.layout);
    return ok({ applied: true, ...summary });
  } catch (e) {
    return errResult(e);
  }
}
