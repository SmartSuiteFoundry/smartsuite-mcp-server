import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { proseMirrorToText } from '../utils/prosemirror.js';

function schemaWriteGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Creating solutions is blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Structure creation is disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to create solutions.');
  }
  return null;
}

export async function handleListSolutions(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const solutions = await ctx.client.listSolutions();
    // Governance: when a solution allowlist is set, other solutions must not even be visible here — a
    // listing that revealed them would let a caller discover (and try to reach) out-of-scope data.
    const allowed = ctx.config.allowedSolutions;
    const visible = allowed.length > 0 ? solutions.filter((s) => allowed.includes((s as { id?: string }).id ?? '')) : solutions;
    return ok({ items: visible, count: visible.length });
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

export async function handleCreateSolution(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const name = args['name'] as string;
  const logoIcon = args['logoIcon'] as string | undefined;
  const logoColor = args['logoColor'] as string | undefined;
  const confirm = args['confirm'] === true;
  if (!name?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'name is required.');

  const body: Record<string, unknown> = { name };
  if (typeof logoIcon === 'string') body['logo_icon'] = logoIcon;
  if (typeof logoColor === 'string') body['logo_color'] = logoColor;

  if (!confirm) {
    return ok({ dryRun: true, wouldCreate: { name, logoIcon: logoIcon ?? null, logoColor: logoColor ?? null }, hint: 'Set confirm=true to create the solution.' });
  }

  try {
    const solution = await ctx.client.createSolution(body);

    // SmartSuite seeds a new solution with a starter table that never goes through
    // create_application, so it misses that tool's record-term handling entirely. Report it, and
    // repair the term if the server left it empty — an empty term breaks the record-view
    // "Add <term>" button and grid/list widgets on any table built from it.
    const seeded: Array<Record<string, unknown>> = [];
    try {
      for (const a of await ctx.client.listApplications(solution.id)) {
        const full = await ctx.client.getApplication(a.id, { forceRefresh: true });
        let term = full.record_term ?? '';
        let repaired = false;
        if (!term.trim()) {
          try {
            const patched = await ctx.client.updateApplication(a.id, { record_term: 'record' });
            term = (patched as { record_term?: string }).record_term ?? 'record';
            repaired = true;
          } catch { /* reported below as an empty term */ }
        }
        seeded.push({ id: a.id, name: full.name, recordTerm: term || null, ...(repaired ? { recordTermRepaired: true } : {}) });
      }
    } catch { /* listing is best-effort; solution creation already succeeded */ }

    return ok({
      created: true,
      solution: { id: solution.id, name: solution.name, slug: (solution as { slug?: string }).slug ?? null },
      ...(seeded.length
        ? {
            existingTables: seeded,
            note: 'SmartSuite pre-creates these table(s) in a new solution. They are NOT created by smartsuite_create_application, so set recordTerm on them with smartsuite_update_application if you need something other than what is shown.',
          }
        : {}),
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleGetSolution(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  try {
    const solution = await ctx.client.getSolution(solutionId);
    // Surface template/catalog lineage explicitly and flatten the ProseMirror description.
    const lineage = {
      template: solution.template ?? null,
      isFromTemplate: solution.template != null,
      status: solution.status ?? null,
      homepageCategory: solution.homepage_category_name ?? null,
      hasDemoData: solution.has_demo_data ?? null,
      applicationsCount: solution.applications_count ?? null,
      automationCount: solution.automation_count ?? null,
      recordsCount: solution.records_count ?? null,
      membersCount: solution.members_count ?? null,
    };
    return ok({
      ...solution,
      description: proseMirrorToText(solution.description) || null,
      lineage,
    });
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
