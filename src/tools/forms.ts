import { randomBytes } from 'node:crypto';
import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { Report } from '../types/smartsuite.js';
import { proseMirrorToText } from '../utils/prosemirror.js';

/**
 * Dedicated form tooling. Forms are reports with `view_mode: "form"` whose
 * structure lives in `form_state`:
 *   form_state.pages[] — each { id, name, page_type, items[] }
 *     page_type "form"       → input page; items are field/heading/section nodes
 *     page_type "review"     → review-before-submit page; review.field_slugs[]
 *     page_type "submission" → terminal thank-you page; submission.{title,...}
 * A form can have multiple input pages (wizard forms).
 *
 * Read tools (list/describe) parse this hierarchy. Write tools (create/update)
 * are gated behind readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE,
 * since a form is structural configuration like a field schema.
 */

const FORM_MODE = 'form';

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Report-id-style slug used for generated form items/pages: `s` + 9 hex. */
function generateItemSlug(): string {
  return 's' + randomBytes(5).toString('hex').slice(0, 9);
}

function publicFormUrl(client: { accountId: string }, report: Report): string | null {
  if (!report.sharing_enabled || !report.sharing_hash) return null;
  return `https://app.smartsuite.com/form/${client.accountId}/${report.sharing_hash}`;
}

/** Extract plain text from a form element's `doc`, which is sometimes a JSON string (callout/consent). */
function docText(doc: unknown): string {
  if (typeof doc === 'string') {
    try {
      return proseMirrorToText(JSON.parse(doc));
    } catch {
      return doc.trim();
    }
  }
  return proseMirrorToText(doc);
}

/** Field-bound items vs. layout/content elements. Content elements never bind a record field. */
const CONTENT_ELEMENT_TYPES = new Set([
  'heading', 'html_block', 'callout', 'consent', 'divider', 'image', 'video', 'recaptcha', 'pdf_viewer',
]);

/** Recursively flatten a page's items, surfacing fields, content elements, and section groupings. */
export function parseItems(items: unknown[], depth = 0): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const raw of items) {
    const item = raw as Record<string, any>;
    const type = item['type'];
    const p = item['params'] ?? {};

    if (type === 'field') {
      const field: Record<string, unknown> = {
        kind: 'field',
        slug: item['slug'],
        required: item['required'] ?? false,
        label: p['label'] ?? null,
        helpText: p['helpText']?.enabled ? (p['helpText']?.value ?? null) : null,
        depth,
      };
      if (p['linked_app_id']) field['linkedAppId'] = p['linked_app_id'];
      // Linked-record fields can render inline or as a table with selected columns.
      if (p['display_type']) field['displayType'] = p['display_type'];
      if (Array.isArray(p['table_visible_fields'])) field['tableVisibleFields'] = p['table_visible_fields'];
      out.push(field);
    } else if (type === 'section') {
      out.push({
        kind: 'section',
        label: p['label'] ?? null,
        caption: p['caption'] ?? null,
        hasConditions: !!p['conditions'],
        conditions: p['conditions'] ?? null,
        depth,
      });
      if (Array.isArray(p['items'])) out.push(...parseItems(p['items'], depth + 1));
    } else if (CONTENT_ELEMENT_TYPES.has(type)) {
      const el: Record<string, unknown> = { kind: type, label: p['label'] ?? null, depth };
      if (p['conditions']) el['hasConditions'] = true;
      // Text-bearing elements
      if (type === 'heading' || type === 'html_block' || type === 'callout' || type === 'consent') {
        el['text'] = docText(p['doc']) || null;
      }
      if (type === 'callout') el['calloutType'] = p['calloutType'] ?? null;
      if (type === 'consent') el['required'] = item['required'] ?? false;
      if (type === 'divider') el['title'] = p['title'] || null;
      if (type === 'image') { el['imageUrl'] = p['imageUrl'] ?? null; el['alignment'] = p['alignment'] ?? null; }
      if (type === 'video') el['videoUrl'] = p['videoUrl'] ?? null;
      if (type === 'pdf_viewer') { el['source'] = p['type'] ?? null; el['url'] = p['url'] || null; }
      out.push(el);
    } else {
      out.push({ kind: type ?? 'unknown', slug: item['slug'], depth });
    }
  }
  return out;
}

/** Summarize one page (input / review / submission). */
function parsePage(page: Record<string, any>): Record<string, unknown> {
  const base: Record<string, unknown> = { id: page['id'], name: page['name'], pageType: page['page_type'] };
  if (page['page_type'] === 'review' && page['review']) {
    base['review'] = {
      title: page['review']['title'] ?? null,
      description: page['review']['description'] ?? null,
      fieldSlugs: page['review']['field_slugs'] ?? [],
    };
  } else if (page['page_type'] === 'submission' && page['submission']) {
    const s = page['submission'];
    base['submission'] = {
      mode: s['mode'] ?? null,
      title: s['title'] ?? null,
      description: s['description'] ?? null,
      displayIcon: s['display_icon'] ?? null,
      redirectUrl: s['redirect_url'] ?? null,
    };
  } else {
    base['items'] = parseItems(Array.isArray(page['items']) ? page['items'] : []);
  }
  return base;
}

/** Collect the bound field items across all input pages, flattening sections. */
export function collectFormFields(formState: Record<string, any> | null | undefined): Array<{ slug: string; required: boolean; label: string | null }> {
  if (!formState) return [];
  const pages = Array.isArray(formState['pages']) ? formState['pages'] : null;
  const lists = pages
    ? pages.filter((p: any) => p['page_type'] === 'form').map((p: any) => p['items'] ?? [])
    : [formState['items'] ?? []];
  const out: Array<{ slug: string; required: boolean; label: string | null }> = [];
  for (const list of lists) {
    for (const item of parseItems(list)) {
      if (item['kind'] === 'field') out.push({ slug: item['slug'] as string, required: !!item['required'], label: (item['label'] as string) ?? null });
    }
  }
  return out;
}

/** Count bound field items across all input pages (handles nested sections). */
export function countFields(formState: Record<string, any> | null | undefined): number {
  if (!formState) return 0;
  const pages = Array.isArray(formState['pages']) ? formState['pages'] : null;
  const lists = pages ? pages.map((p: any) => p['items'] ?? []) : [formState['items'] ?? []];
  let n = 0;
  const walk = (items: unknown[]) => {
    for (const raw of items) {
      const item = raw as Record<string, any>;
      if (item['type'] === 'field') n++;
      else if (item['type'] === 'section' && Array.isArray(item['params']?.items)) walk(item['params']['items']);
    }
  };
  lists.forEach(walk);
  return n;
}

// ── Read tools ────────────────────────────────────────────────────────────────

export async function handleListForms(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  try {
    const reports = await ctx.client.listReports(applicationId);
    const forms = reports.filter((r) => r.view_mode === FORM_MODE);
    const items = forms.map((f) => ({
      id: f.id,
      name: f.label,
      description: f.description ?? null,
      order: f.order ?? 0,
      pageCount: Array.isArray((f.form_state as any)?.pages) ? (f.form_state as any).pages.length : null,
      fieldCount: countFields(f.form_state as any),
      sharingEnabled: f.sharing_enabled ?? false,
      publicUrl: publicFormUrl(ctx.client, f),
    }));
    return ok({ applicationId, count: items.length, items });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleDescribeForm(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const formId = args['formId'] as string;
  try {
    const reports = await ctx.client.listReports(applicationId);
    const form = reports.find((r) => r.id === formId && r.view_mode === FORM_MODE);
    if (!form) return err('SMARTSUITE_NOT_FOUND', `Form "${formId}" not found in application ${applicationId}`);

    const fs = (form.form_state ?? {}) as Record<string, any>;
    const pages = Array.isArray(fs['pages']) ? fs['pages'].map(parsePage) : null;
    return ok({
      id: form.id,
      name: form.label,
      description: form.description ?? null,
      order: form.order ?? 0,
      settings: {
        title: fs['title'] ?? null,
        description: fs['description'] ?? null,
        submitLabel: fs['submit_label'] ?? null,
        displayMessage: fs['display_message'] ?? null,
        redirectToUrl: fs['redirect_to_url'] ?? null,
        displaySmartSuiteBranding: fs['display_smartsuite_branding'] ?? null,
        hasProgressRestore: fs['has_progress_restore'] ?? null,
        logoHandle: fs['logo_handle'] ?? null,
        tabTitle: fs['tab_title'] ?? null,
      },
      sharing: {
        enabled: form.sharing_enabled ?? false,
        hash: form.sharing_hash || null,
        publicUrl: publicFormUrl(ctx.client, form),
        isPasswordProtected: form.is_password_protected ?? false,
      },
      fieldCount: countFields(fs),
      // Prefer the paged structure; fall back to the legacy flat items array.
      pages: pages ?? undefined,
      items: pages ? undefined : parseItems(Array.isArray(fs['items']) ? fs['items'] : []),
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── Write tools (schema-write gated) ───────────────────────────────────────────

function writeGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Form writes are blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Form writes are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to enable creating/updating forms.');
  }
  return null;
}

interface FieldSpec {
  slug: string;
  required?: boolean;
  label?: string;
  helpText?: string;
}

/** Normalize a `fields` argument (array of slug strings or {slug,...} objects) into field items. */
export function fieldsToItems(fields: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => {
    const spec: FieldSpec = typeof f === 'string' ? { slug: f } : (f as FieldSpec);
    return {
      type: 'field',
      slug: spec.slug,
      required: spec.required ?? false,
      params: {
        label: spec.label ?? null,
        helpText: { enabled: !!spec.helpText, value: spec.helpText ?? null },
        help_text_as_tooltip: true,
      },
    };
  });
}

/** Build a minimal valid form_state: one input page of fields + a submission page. */
function buildFormState(fieldItems: Array<Record<string, unknown>>, settings: Record<string, unknown>): Record<string, unknown> {
  return {
    ...settings,
    pages: [
      { id: generateItemSlug(), name: 'Page', page_type: 'form', items: fieldItems },
      {
        id: generateItemSlug(),
        name: 'Submission',
        page_type: 'submission',
        items: [],
        submission: {
          mode: 'message',
          display_icon: true,
          title: (settings['display_message'] as string) || 'Thank you!',
          description: 'Form was submitted.',
          redirect_url: (settings['redirect_to_url'] as string) || null,
        },
      },
    ],
  };
}

function collectSettings(args: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (args['title'] !== undefined) s['title'] = args['title'];
  if (args['description'] !== undefined) s['description'] = args['description'];
  if (args['submitLabel'] !== undefined) s['submit_label'] = args['submitLabel'];
  if (args['redirectToUrl'] !== undefined) s['redirect_to_url'] = args['redirectToUrl'];
  if (args['displaySmartSuiteBranding'] !== undefined) s['display_smartsuite_branding'] = args['displaySmartSuiteBranding'];
  return s;
}

export async function handleCreateForm(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const label = args['label'] as string;
  const fields = args['fields'];
  const confirm = args['confirm'] === true;
  if (!label?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'label is required.');

  try {
    // Verify the target app exists and learn its solution (required by POST /reports/).
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const solution = (schema as { solution?: string }).solution;
    if (!solution) return err('SMARTSUITE_VALIDATION_ERROR', `Could not resolve the solution for application ${applicationId}.`);

    // Validate field slugs against the schema so we never build a form referencing unknown fields.
    const knownSlugs = new Set((schema.structure ?? []).map((f) => f.slug));
    const specs: FieldSpec[] = Array.isArray(fields) ? fields.map((f) => (typeof f === 'string' ? { slug: f } : (f as FieldSpec))) : [];
    const unknown = specs.filter((s) => !knownSlugs.has(s.slug)).map((s) => s.slug);
    if (unknown.length) return err('SMARTSUITE_VALIDATION_ERROR', `Unknown field slug(s): ${unknown.join(', ')}. Use smartsuite_describe_application to find valid slugs.`);

    const isUnique = await ctx.client.validateReportLabel(applicationId, label);
    if (!isUnique) {
      const suggestion = await ctx.client.generateReportLabel(applicationId, label);
      return err('SMARTSUITE_VALIDATION_ERROR', `A report named "${label}" already exists in this application. Try "${suggestion}".`);
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        wouldCreate: { applicationId, solution, label, viewMode: FORM_MODE, fieldCount: specs.length, fields: specs.map((s) => s.slug) },
        hint: 'Label is available. Set confirm=true to create the form.',
      });
    }

    const created = await ctx.client.createReport({ application: applicationId, solution, label, view_mode: FORM_MODE });
    // If fields/settings were supplied, lay out the initial structure in a follow-up PATCH.
    const settings = collectSettings(args);
    const fieldItems = fieldsToItems(fields);
    if (fieldItems.length || Object.keys(settings).length) {
      await ctx.client.updateReport(created.id, { form_state: buildFormState(fieldItems, settings) });
    }
    return ok({
      created: true,
      mode: ctx.config.mode,
      form: { id: created.id, name: created.label, applicationId, fieldCount: fieldItems.length, publicUrl: publicFormUrl(ctx.client, created) },
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleUpdateForm(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const formId = args['formId'] as string;
  const fields = args['fields'];
  const rawFormState = args['formState'] as Record<string, unknown> | undefined;
  const confirm = args['confirm'] === true;
  const settings = collectSettings(args);

  if (rawFormState === undefined && fields === undefined && Object.keys(settings).length === 0) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'Provide at least one of: formState, fields, or a settings field (title/description/submitLabel/redirectToUrl/displaySmartSuiteBranding).');
  }

  try {
    const reports = await ctx.client.listReports(applicationId);
    const form = reports.find((r) => r.id === formId && r.view_mode === FORM_MODE);
    if (!form) return err('SMARTSUITE_NOT_FOUND', `Form "${formId}" not found in application ${applicationId}`);

    const current = (form.form_state ?? {}) as Record<string, any>;
    let nextFormState: Record<string, unknown>;

    if (rawFormState !== undefined) {
      // Escape hatch: caller supplies a full form_state (advanced; for the services team).
      nextFormState = rawFormState;
    } else if (fields !== undefined) {
      // Validate slugs, then rebuild the first input page while preserving other pages.
      const schema = await ctx.client.getApplicationSchema(applicationId);
      const knownSlugs = new Set((schema.structure ?? []).map((f) => f.slug));
      const specs: FieldSpec[] = Array.isArray(fields) ? fields.map((f) => (typeof f === 'string' ? { slug: f } : (f as FieldSpec))) : [];
      const unknown = specs.filter((s) => !knownSlugs.has(s.slug)).map((s) => s.slug);
      if (unknown.length) return err('SMARTSUITE_VALIDATION_ERROR', `Unknown field slug(s): ${unknown.join(', ')}.`);

      const pages: any[] = Array.isArray(current['pages']) ? JSON.parse(JSON.stringify(current['pages'])) : [];
      const firstFormIdx = pages.findIndex((p) => p['page_type'] === 'form');
      const fieldItems = fieldsToItems(fields);
      if (firstFormIdx >= 0) {
        pages[firstFormIdx]['items'] = fieldItems;
        nextFormState = { ...current, ...settings, pages };
      } else {
        nextFormState = buildFormState(fieldItems, { ...current, ...settings });
      }
    } else {
      // Settings-only change: merge into existing form_state.
      nextFormState = { ...current, ...settings };
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        wouldUpdate: { formId, changed: { settings: Object.keys(settings), fields: fields !== undefined, rawFormState: rawFormState !== undefined } },
        hint: 'Set confirm=true to apply the change.',
      });
    }

    await ctx.client.updateReport(formId, { form_state: nextFormState });
    return ok({ updated: true, mode: ctx.config.mode, formId, note: 'Form structure updated.' });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/**
 * Submit a form: create a record through the form's submission pipeline, exactly
 * as a user filling out the form would. Two-phase by design:
 *   - Called WITHOUT `values` → returns the form's input spec (fields to fill,
 *     with type and choice hints) so the caller knows what to ask for.
 *   - Called WITH `values` → validates against the form's fields (unknown-slug
 *     and required checks) and submits. Requires readwrite/admin mode (it creates
 *     a record), but NOT schema write.
 */
export async function handleSubmitForm(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const formId = args['formId'] as string;
  const values = args['values'] as Record<string, unknown> | undefined;
  const hasValues = values !== undefined && values !== null && typeof values === 'object' && Object.keys(values).length > 0;

  // Writes (an actual submit) require a non-readonly mode; the preview is read-only.
  if (hasValues && ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Submitting a form creates a record and is blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }

  try {
    const reports = await ctx.client.listReports(applicationId);
    const form = reports.find((r) => r.id === formId && r.view_mode === FORM_MODE);
    if (!form) return err('SMARTSUITE_NOT_FOUND', `Form "${formId}" not found in application ${applicationId}`);

    const formFields = collectFormFields(form.form_state as any);

    // ── Preview mode: describe the inputs to collect. ──
    if (!hasValues) {
      const schema = await ctx.client.getApplicationSchema(applicationId);
      const bySlug = new Map((schema.structure ?? []).map((f) => [f.slug, f]));
      const fields = formFields.map((ff) => {
        const def = bySlug.get(ff.slug);
        const out: Record<string, unknown> = { slug: ff.slug, label: ff.label ?? def?.label ?? ff.slug, required: ff.required, type: def?.field_type ?? null };
        if (def?.params.choices?.length) out['choices'] = def.params.choices.map((c) => ({ value: c.value, label: c.label }));
        if (def?.params.linked_application) out['linkedApplication'] = def.params.linked_application;
        return out;
      });
      return ok({
        mode: 'preview',
        formId,
        formName: form.label,
        applicationId,
        fields,
        hint: 'Collect values for these fields (keyed by slug, using SmartSuite record value shapes), then call smartsuite_submit_form again with `values` to submit. Required fields must be present.',
      });
    }

    // ── Submit mode: validate against the form, then create the record. ──
    const formSlugs = new Set(formFields.map((f) => f.slug));
    const unknown = Object.keys(values!).filter((s) => !formSlugs.has(s));
    if (unknown.length) {
      return err('SMARTSUITE_VALIDATION_ERROR', `These fields are not on the form: ${unknown.join(', ')}. Call smartsuite_submit_form without values to see the form's fields.`);
    }
    const missing = formFields.filter((f) => f.required && !(f.slug in values!)).map((f) => f.label ?? f.slug);
    if (missing.length) {
      return err('SMARTSUITE_VALIDATION_ERROR', `Missing required field(s): ${missing.join(', ')}.`);
    }

    const result = await ctx.client.submitForm(formId, values!);
    // The form submit endpoint returns 201 with an empty body — no record id is
    // returned. The record IS created; report success without a fabricated id.
    const recordId = (result && typeof result === 'object' ? (result as Record<string, unknown>)['id'] : undefined) ?? null;
    return ok({
      submitted: true,
      mode: ctx.config.mode,
      formId,
      applicationId,
      recordId,
      note: recordId
        ? undefined
        : 'Record created via the form pipeline. The submit endpoint returns no body, so the new record id is not available; use smartsuite_list_records to locate it if needed.',
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
