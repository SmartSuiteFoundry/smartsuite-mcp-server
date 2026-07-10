import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { encodeCursor, decodeCursor } from '../utils/pagination.js';
import { readFormat, toCompactTable } from '../utils/format.js';
import { ApplicationDetail, FilterClause, SmartSuiteRecord } from '../types/smartsuite.js';

/** Render projected records as either a `{ items }` array or a compact columns+rows table. */
function formatItems(items: Array<Record<string, unknown>>, args: Record<string, unknown>): Record<string, unknown> {
  return readFormat(args) === 'compact' ? { ...toCompactTable(items) } : { items };
}

const SYSTEM_FIELDS = new Set([
  'id', 'title', 'application_id', 'first_created', 'last_updated',
  'application_slug', 'autonumber', 'comments_count', 'ranking',
  'followed_by', 'fields_metadata',
]);

// ── Field context ──────────────────────────────────────────────────────────────

interface FieldCtx {
  label: string;
  type: string;
  helpText?: string;
  linkedApplication?: string;
  linkedFieldSlug?: string;
}

function buildContextMap(schema: ApplicationDetail): Record<string, FieldCtx> {
  const map: Record<string, FieldCtx> = {};
  for (const f of schema.structure ?? []) {
    const entry: FieldCtx = { label: f.label, type: f.field_type };
    if (f.params.help_text)          entry.helpText          = f.params.help_text;
    if (f.params.linked_application) entry.linkedApplication = f.params.linked_application;
    if (f.params.linked_field_slug)  entry.linkedFieldSlug   = f.params.linked_field_slug;
    map[f.slug] = entry;
  }
  return map;
}

// For get_record: embed context inline with each field value.
function enrichFieldsInline(
  fields: Record<string, unknown>,
  ctxMap: Record<string, FieldCtx>,
) {
  return Object.entries(fields).map(([slug, value]) => {
    const meta = ctxMap[slug];
    return {
      slug,
      label:  meta?.label ?? slug,
      type:   meta?.type  ?? 'unknown',
      ...(meta?.helpText          ? { helpText:          meta.helpText }          : {}),
      ...(meta?.linkedApplication ? { linkedApplication: meta.linkedApplication } : {}),
      ...(meta?.linkedFieldSlug   ? { linkedFieldSlug:   meta.linkedFieldSlug }   : {}),
      value,
    };
  });
}

// ── Record projection ──────────────────────────────────────────────────────────

function projectRecord(record: SmartSuiteRecord, fieldSlugs: string[] | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = { id: record.id, title: record.title };
  if (record.first_created) result['createdAt'] = record.first_created.on;
  if (record.last_updated)  result['updatedAt']  = record.last_updated.on;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SYSTEM_FIELDS.has(key)) continue;
    if (fieldSlugs && fieldSlugs.length > 0 && !fieldSlugs.includes(key)) continue;
    fields[key] = value;
  }
  result['fields'] = fields;
  return result;
}

// ── Enrichment helper ──────────────────────────────────────────────────────────

function shouldEnrich(args: Record<string, unknown>, ctx: ToolContext): boolean {
  const explicit = args['includeFieldContext'];
  if (explicit !== undefined) return explicit as boolean;
  return ctx.config.aiEnrichedRecords;
}

async function fetchContextMap(
  applicationId: string,
  ctx: ToolContext,
): Promise<Record<string, FieldCtx>> {
  const schema = await ctx.client.getApplicationSchema(applicationId);
  return buildContextMap(schema);
}

// ── Handlers ───────────────────────────────────────────────────────────────────

export async function handleListRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const ids           = args['ids']   as string[] | undefined;
  const fields        = args['fields'] as string[] | undefined;
  const rawLimit      = (args['limit'] as number | undefined) ?? 50;
  const cursor        = args['cursor'] as string | undefined;
  const sort          = args['sort']   as Array<{ field: string; direction: 'asc' | 'desc' }> | undefined;
  const enrich        = shouldEnrich(args, ctx);

  try {
    let ctxMap: Record<string, FieldCtx> | null = null;
    if (enrich) ctxMap = await fetchContextMap(applicationId, ctx);

    // Fetch by IDs — skip pagination.
    if (ids && ids.length > 0) {
      const res   = await ctx.client.listRecords(applicationId, { ids, sort });
      const items = res.items.map((r) => projectRecord(r, fields));
      const response: Record<string, unknown> = { ...formatItems(items, args), total: items.length, count: items.length, nextCursor: null };
      if (ctxMap) response['_fieldContext'] = ctxMap;
      return ok(response);
    }

    const limit     = Math.min(rawLimit, ctx.config.maxRecords);
    const offset    = cursor ? decodeCursor(cursor) : 0;
    const res       = await ctx.client.listRecords(applicationId, { offset, limit, sort });
    const items     = res.items.map((r) => projectRecord(r, fields));
    const nextOffset = offset + res.items.length;
    const nextCursor = nextOffset < res.total ? encodeCursor(nextOffset) : null;

    const response: Record<string, unknown> = { ...formatItems(items, args), total: res.total, count: items.length, nextCursor };
    if (ctxMap) response['_fieldContext'] = ctxMap;
    return ok(response);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleGetRecord(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const recordId      = args['recordId']      as string;
  const fields        = args['fields']        as string[] | undefined;
  const enrich        = shouldEnrich(args, ctx);

  try {
    const [record, ctxMap] = await Promise.all([
      ctx.client.getRecord(applicationId, recordId),
      enrich ? fetchContextMap(applicationId, ctx) : Promise.resolve(null),
    ]);

    const projected = projectRecord(record, fields);

    if (ctxMap) {
      // For a single record, embed context inline with each field value.
      const rawFields = projected['fields'] as Record<string, unknown>;
      projected['fields'] = enrichFieldsInline(rawFields, ctxMap);
    }

    return ok(projected);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleSearchRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const query         = args['query']        as string;
  const fieldSlugs    = args['fieldSlugs']   as string[] | undefined;
  const rawLimit      = (args['limit']  as number | undefined) ?? 25;
  const cursor        = args['cursor']  as string | undefined;
  const enrich        = shouldEnrich(args, ctx);

  if (!query || query.trim() === '') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'SMARTSUITE_VALIDATION_ERROR', message: 'query is required' } }, null, 2) }], isError: true };
  }

  const limit  = Math.min(rawLimit, ctx.config.maxRecords);
  const offset = cursor ? decodeCursor(cursor) : 0;

  const searchFields = fieldSlugs && fieldSlugs.length > 0 ? fieldSlugs : ['title'];
  const filter: FilterClause = {
    operator: 'or',
    fields: searchFields.map((slug) => ({ field: slug, comparison: 'contains', value: query })),
  };

  try {
    let ctxMap: Record<string, FieldCtx> | null = null;
    if (enrich) ctxMap = await fetchContextMap(applicationId, ctx);

    const res        = await ctx.client.listRecords(applicationId, { filter, offset, limit });
    const items      = res.items.map((r) => projectRecord(r, undefined));
    const nextOffset = offset + res.items.length;
    const nextCursor = nextOffset < res.total ? encodeCursor(nextOffset) : null;

    const response: Record<string, unknown> = { ...formatItems(items, args), total: res.total, count: items.length, query, nextCursor };
    if (ctxMap) response['_fieldContext'] = ctxMap;
    return ok(response);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleListDeletedRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  const applicationId = args['applicationId'] as string | undefined; // optional client-side filter
  const fields = args['fields'] as string[] | undefined;
  const pageSize = (args['pageSize'] as number | undefined) ?? 100;
  const cursor = args['cursor'] as string | undefined;
  if (!solutionId) return err('SMARTSUITE_VALIDATION_ERROR', 'solutionId is required (deleted records are listed per solution / trash).');

  try {
    const res = await ctx.client.listDeletedRecords(solutionId, { pageSize, fields, cursor });
    const records = (res.records ?? []).filter((r) => {
      const app = r['application_id'] as string;
      if (ctx.config.deniedApplications.includes(app)) return false;
      if (ctx.config.allowedApplications.length > 0 && !ctx.config.allowedApplications.includes(app)) return false;
      if (applicationId && app !== applicationId) return false;
      return true;
    });
    const items = records.map((r) => ({
      id: r['id'],
      title: r['title'] ?? null,
      applicationId: r['application_id'] ?? null,
      applicationName: r['application_name'] ?? null,
      deletedBy: r['deleted_by'] ?? null,
      deletedAt: (r['deleted_date'] as { date?: string } | undefined)?.date ?? null,
    }));
    return ok({ items, count: items.length, total: res.count ?? items.length, nextCursor: res.next_cursor ?? null });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleQueryRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const filter        = args['filter'] as FilterClause;
  const fields        = args['fields'] as string[] | undefined;
  const sort          = args['sort']   as Array<{ field: string; direction: 'asc' | 'desc' }> | undefined;
  const rawLimit      = (args['limit']  as number | undefined) ?? 50;
  const cursor        = args['cursor']  as string | undefined;
  const enrich        = shouldEnrich(args, ctx);

  const limit  = Math.min(rawLimit, ctx.config.maxRecords);
  const offset = cursor ? decodeCursor(cursor) : 0;

  try {
    let ctxMap: Record<string, FieldCtx> | null = null;
    if (enrich) ctxMap = await fetchContextMap(applicationId, ctx);

    const res        = await ctx.client.listRecords(applicationId, { filter, sort, offset, limit });
    const items      = res.items.map((r) => projectRecord(r, fields));
    const nextOffset = offset + res.items.length;
    const nextCursor = nextOffset < res.total ? encodeCursor(nextOffset) : null;

    const response: Record<string, unknown> = { ...formatItems(items, args), total: res.total, count: items.length, nextCursor };
    if (ctxMap) response['_fieldContext'] = ctxMap;
    return ok(response);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
