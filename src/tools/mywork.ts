import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';

/**
 * My Work — the authenticated user's assigned items (comment mentions, checklist
 * items, and records assigned via people fields). A read/Q&A tool: it surfaces
 * what's on the user's plate, with filters and a summary for questions like
 * "how many open items are overdue?" or "what's assigned to me in solution X?".
 */

const PERIODS = new Set(['today', 'this_week', 'this_month', 'previous_month', 'last_year']);
const ITEM_TYPES = new Set(['comment', 'checklist_item', 'record']);
const PREVIEW_LEN = 200;

interface SlimItem {
  id: unknown;
  title: unknown;
  itemType: unknown;
  status: unknown;
  priority: unknown;
  solution: unknown;
  application: unknown;
  recordId: unknown;
  fieldName: unknown;
  dueDate: string | null;
  overdue: boolean;
  lastUpdated: unknown;
  resolvedDate: unknown;
  preview: string | null;
}

/** Effective due date is due_date.to_date.date; null when unset. */
function dueDateOf(item: Record<string, any>): string | null {
  return item['due_date']?.to_date?.date ?? null;
}

function truncate(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > PREVIEW_LEN ? `${t.slice(0, PREVIEW_LEN)}…` : t;
}

function slim(item: Record<string, any>, now: number): SlimItem {
  const due = dueDateOf(item);
  return {
    id: item['id'],
    title: item['title'] ?? null,
    itemType: item['item_type'] ?? null,
    status: item['status'] ?? null,
    priority: item['priority'] ?? null,
    solution: item['solution'] ?? null,
    application: item['application'] ?? null,
    recordId: item['record_id'] ?? null,
    fieldName: item['field_name'] ?? null,
    dueDate: due,
    overdue: !!due && !item['resolved_date'] && new Date(due).getTime() < now,
    lastUpdated: item['last_updated']?.on ?? null,
    resolvedDate: item['resolved_date'] ?? null,
    preview: truncate(item['field_str_value']),
  };
}

/** Build a count summary for Q&A: totals plus breakdowns by type, priority, and solution. */
function summarize(items: SlimItem[]): Record<string, unknown> {
  const tally = (key: keyof SlimItem) => {
    const out: Record<string, number> = {};
    for (const i of items) {
      const k = (i[key] ?? 'none') as string;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  return {
    total: items.length,
    overdue: items.filter((i) => i.overdue).length,
    withDueDate: items.filter((i) => i.dueDate).length,
    byItemType: tally('itemType'),
    byPriority: tally('priority'),
    bySolution: tally('solution'),
  };
}

export async function handleListMyWork(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const status = (args['status'] as string) === 'resolved' ? 'resolved' : 'open';
  const period = args['period'] as string | undefined;
  const solutionId = args['solutionId'] as string | undefined;
  const applicationId = args['applicationId'] as string | undefined;
  const itemType = args['itemType'] as string | undefined;
  const priority = args['priority'] as string | undefined;
  const overdueOnly = args['overdueOnly'] === true;
  const limit = typeof args['limit'] === 'number' ? (args['limit'] as number) : 50;

  if (period && !PERIODS.has(period)) {
    return ok({ error: { code: 'SMARTSUITE_VALIDATION_ERROR', message: `period must be one of: ${[...PERIODS].join(', ')}` } });
  }
  if (itemType && !ITEM_TYPES.has(itemType)) {
    return ok({ error: { code: 'SMARTSUITE_VALIDATION_ERROR', message: `itemType must be one of: ${[...ITEM_TYPES].join(', ')}` } });
  }

  try {
    const { items: raw, count } = await ctx.client.getMyWork(status === 'resolved', period);
    const now = Date.now();
    let slimmed = (raw ?? []).map((i) => slim(i as Record<string, any>, now));

    // Client-side filters.
    if (solutionId) slimmed = slimmed.filter((i) => i.solution === solutionId);
    if (applicationId) slimmed = slimmed.filter((i) => i.application === applicationId);
    if (itemType) slimmed = slimmed.filter((i) => i.itemType === itemType);
    if (priority) slimmed = slimmed.filter((i) => i.priority === priority);
    if (overdueOnly) slimmed = slimmed.filter((i) => i.overdue);

    const summary = summarize(slimmed);
    const truncated = slimmed.length > limit;
    return ok({
      status,
      period: period ?? null,
      workspace: ctx.client.accountId,
      summary,
      ...(count ? { resolvedPeriodCounts: count } : {}),
      returned: Math.min(slimmed.length, limit),
      truncated,
      ...(truncated ? { note: `Showing first ${limit} of ${slimmed.length}. Use filters or a smaller scope to narrow.` } : {}),
      items: slimmed.slice(0, limit),
    });
  } catch (e) {
    const er = toErrorResponse(e);
    // The My Work endpoint 500s in some workspaces (server-side data issue); make that legible.
    const hint =
      (er as { code?: string }).code === 'SMARTSUITE_API_ERROR'
        ? ' My Work may be unavailable for this workspace (the endpoint can return a server error for some accounts).'
        : '';
    return { content: [{ type: 'text', text: JSON.stringify({ error: { ...er, message: `${(er as { message?: string }).message ?? ''}${hint}` } }, null, 2) }], isError: true };
  }
}

/**
 * Build the PATCH body for a My Work update from tool args. Returns the body, or
 * an error string if the inputs are invalid. `dueDate: null` clears the due date.
 */
export function buildMyWorkPatch(args: Record<string, unknown>): { body?: Record<string, unknown>; error?: string } {
  const body: Record<string, unknown> = {};

  const status = args['status'];
  if (status !== undefined) {
    if (status !== 'open' && status !== 'resolved') return { error: 'status must be "open" or "resolved".' };
    body['status'] = status;
  }

  if ('dueDate' in args) {
    const dueDate = args['dueDate'];
    if (dueDate === null) {
      body['due_date'] = { to_date: { date: null } };
    } else if (typeof dueDate === 'string') {
      if (Number.isNaN(new Date(dueDate).getTime())) return { error: `dueDate "${dueDate}" is not a valid date (use ISO 8601, e.g. 2026-07-01T00:00:00Z).` };
      body['due_date'] = { to_date: { date: dueDate } };
    } else {
      return { error: 'dueDate must be an ISO date string, or null to clear it.' };
    }
  }

  if (Object.keys(body).length === 0) return { error: 'Provide at least one of: status, dueDate.' };
  return { body };
}

export async function handleUpdateMyWork(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Updating My Work items is blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  const itemId = args['itemId'] as string;
  if (!itemId) return err('SMARTSUITE_VALIDATION_ERROR', 'itemId is required.');

  const { body, error } = buildMyWorkPatch(args);
  if (error) return err('SMARTSUITE_VALIDATION_ERROR', error);

  try {
    const updated = await ctx.client.updateMyWork(itemId, body!);
    return ok({ updated: true, mode: ctx.config.mode, item: slim(updated as Record<string, any>, Date.now()) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// Exported for unit tests.
export const _internal = { slim, summarize, truncate, dueDateOf };
