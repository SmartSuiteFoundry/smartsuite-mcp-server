import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';
import { encodeCursor, decodeCursor } from '../utils/pagination.js';
import { FilterClause, SmartSuiteRecord } from '../types/smartsuite.js';

const SYSTEM_FIELDS = new Set(['id', 'title', 'application_id', 'first_created', 'last_updated', 'application_slug', 'autonumber', 'comments_count', 'ranking', 'followed_by', 'fields_metadata']);

function projectRecord(record: SmartSuiteRecord, fieldSlugs: string[] | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: record.id,
    title: record.title,
  };
  if (record.first_created) result['createdAt'] = record.first_created.on;
  if (record.last_updated) result['updatedAt'] = record.last_updated.on;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SYSTEM_FIELDS.has(key)) continue;
    if (fieldSlugs && fieldSlugs.length > 0 && !fieldSlugs.includes(key)) continue;
    fields[key] = value;
  }
  result['fields'] = fields;
  return result;
}

export async function handleListRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const ids = args['ids'] as string[] | undefined;
  const fields = args['fields'] as string[] | undefined;
  const rawLimit = (args['limit'] as number | undefined) ?? 50;
  const cursor = args['cursor'] as string | undefined;
  const sort = args['sort'] as Array<{ field: string; direction: 'asc' | 'desc' }> | undefined;

  // When fetching by IDs, skip pagination — return all requested records in one shot.
  if (ids && ids.length > 0) {
    try {
      const res = await ctx.client.listRecords(applicationId, { ids, sort });
      const items = res.items.map((r) => projectRecord(r, fields));
      return ok({ items, total: items.length, count: items.length, nextCursor: null });
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
    }
  }

  const limit = Math.min(rawLimit, ctx.config.maxRecords);
  const offset = cursor ? decodeCursor(cursor) : 0;

  try {
    const res = await ctx.client.listRecords(applicationId, { offset, limit, sort });
    const items = res.items.map((r) => projectRecord(r, fields));
    const nextOffset = offset + res.items.length;
    const nextCursor = nextOffset < res.total ? encodeCursor(nextOffset) : null;

    return ok({ items, total: res.total, count: items.length, nextCursor });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleGetRecord(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;
  const fields = args['fields'] as string[] | undefined;

  try {
    const record = await ctx.client.getRecord(applicationId, recordId);
    return ok(projectRecord(record, fields));
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleSearchRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const query = args['query'] as string;
  const fieldSlugs = args['fieldSlugs'] as string[] | undefined;
  const rawLimit = (args['limit'] as number | undefined) ?? 25;
  const cursor = args['cursor'] as string | undefined;

  const limit = Math.min(rawLimit, ctx.config.maxRecords);
  const offset = cursor ? decodeCursor(cursor) : 0;

  if (!query || query.trim() === '') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'SMARTSUITE_VALIDATION_ERROR', message: 'query is required' } }, null, 2) }], isError: true };
  }

  // Build OR filter across requested fields (or title if none specified)
  const searchFields = fieldSlugs && fieldSlugs.length > 0 ? fieldSlugs : ['title'];
  const filter: FilterClause = {
    operator: 'or',
    fields: searchFields.map((slug) => ({
      field: slug,
      comparison: 'contains',
      value: query,
    })),
  };

  try {
    const res = await ctx.client.listRecords(applicationId, { filter, offset, limit });
    const items = res.items.map((r) => projectRecord(r, undefined));
    const nextOffset = offset + res.items.length;
    const nextCursor = nextOffset < res.total ? encodeCursor(nextOffset) : null;

    return ok({ items, total: res.total, count: items.length, query, nextCursor });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleQueryRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const filter = args['filter'] as FilterClause;
  const fields = args['fields'] as string[] | undefined;
  const sort = args['sort'] as Array<{ field: string; direction: 'asc' | 'desc' }> | undefined;
  const rawLimit = (args['limit'] as number | undefined) ?? 50;
  const cursor = args['cursor'] as string | undefined;

  const limit = Math.min(rawLimit, ctx.config.maxRecords);
  const offset = cursor ? decodeCursor(cursor) : 0;

  try {
    const res = await ctx.client.listRecords(applicationId, { filter, sort, offset, limit });
    const items = res.items.map((r) => projectRecord(r, fields));
    const nextOffset = offset + res.items.length;
    const nextCursor = nextOffset < res.total ? encodeCursor(nextOffset) : null;

    return ok({ items, total: res.total, count: items.length, nextCursor });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
