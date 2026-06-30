import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';

// SmartSuite file/attachment fields hold an array of file objects: { handle, metadata:{filename,...}, ... }.
// "Moving" attachments copies those file objects from one file field to another (handles reference
// existing storage — no re-upload) and clears the source.

type FileObj = Record<string, unknown>;

/** Compute the target field's new file array. mode 'append' keeps existing target files; 'replace' overwrites. */
export function mergeAttachments(targetExisting: FileObj[], sourceFiles: FileObj[], mode: 'append' | 'replace'): FileObj[] {
  return mode === 'replace' ? [...sourceFiles] : [...targetExisting, ...sourceFiles];
}

const asFiles = (v: unknown): FileObj[] => (Array.isArray(v) ? (v as FileObj[]) : []);
const fileNames = (files: FileObj[]): string[] => files.map((f) => ((f?.['metadata'] as FileObj)?.['filename'] as string) ?? (f?.['handle'] as string) ?? '?');

/**
 * Move attachments from one file field to another. Per record: copy the source field's files into the
 * target field (append or replace) and clear the source. Targets one record (recordId) or every record
 * that has source files (allRecords, capped). Requires readwrite/admin; dry-run preview unless confirm.
 */
export async function handleMoveAttachments(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Moving attachments writes record data and is blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }

  const applicationId = args['applicationId'] as string;
  const sourceFieldSlug = args['sourceFieldSlug'] as string;
  const targetFieldSlug = args['targetFieldSlug'] as string;
  const recordId = args['recordId'] as string | undefined;
  const allRecords = args['allRecords'] === true;
  const mode = (args['mode'] as string) === 'replace' ? 'replace' : 'append';
  const clearSource = (args['clearSource'] as boolean | undefined) ?? true;
  const confirm = args['confirm'] === true;

  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!sourceFieldSlug || !targetFieldSlug) return err('SMARTSUITE_VALIDATION_ERROR', 'sourceFieldSlug and targetFieldSlug are required.');
  if (sourceFieldSlug === targetFieldSlug) return err('SMARTSUITE_VALIDATION_ERROR', 'source and target fields must differ.');
  if (!recordId && !allRecords) return err('SMARTSUITE_VALIDATION_ERROR', 'Provide recordId (one record) or allRecords:true.');

  try {
    // Validate both fields exist and are file fields.
    const app = await ctx.client.getApplicationSchema(applicationId);
    const bySlug = new Map((app.structure ?? []).map((f) => [f.slug, f]));
    for (const [slug, kind] of [[sourceFieldSlug, 'source'], [targetFieldSlug, 'target']] as const) {
      const f = bySlug.get(slug);
      if (!f) return err('SMARTSUITE_NOT_FOUND', `${kind} field "${slug}" not found in application ${applicationId}.`);
      if (f.field_type !== 'filefield') return err('SMARTSUITE_VALIDATION_ERROR', `${kind} field "${slug}" is a ${f.field_type}, not a filefield.`);
    }

    // Gather the target records.
    let records: Array<Record<string, unknown>>;
    if (recordId) {
      records = [await ctx.client.getRecord(applicationId, recordId) as unknown as Record<string, unknown>];
    } else {
      const res = await ctx.client.listRecords(applicationId, { limit: ctx.config.maxRecords });
      records = ((res.items ?? []) as Array<Record<string, unknown>>).filter((r) => asFiles(r[sourceFieldSlug]).length > 0);
    }

    const plan = records
      .map((r) => ({ id: r['id'] as string, files: asFiles(r[sourceFieldSlug]), target: asFiles(r[targetFieldSlug]) }))
      .filter((p) => p.files.length > 0);

    if (plan.length === 0) {
      return ok({ moved: 0, note: `No records with files in "${sourceFieldSlug}".` });
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        wouldMove: { records: plan.length, mode, clearSource, from: sourceFieldSlug, to: targetFieldSlug },
        sample: plan.slice(0, 5).map((p) => ({ recordId: p.id, files: fileNames(p.files) })),
        note: allRecords && records.length >= ctx.config.maxRecords ? `Capped at maxRecords=${ctx.config.maxRecords}; run per-record or raise the cap for more.` : 'Re-call with confirm:true to apply.',
      });
    }

    let moved = 0;
    for (const p of plan) {
      const patch: Record<string, unknown> = { [targetFieldSlug]: mergeAttachments(p.target, p.files, mode) };
      if (clearSource) patch[sourceFieldSlug] = [];
      await ctx.client.updateRecord(applicationId, p.id, patch);
      moved++;
    }
    return ok({ moved, from: sourceFieldSlug, to: targetFieldSlug, mode, clearedSource: clearSource });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
