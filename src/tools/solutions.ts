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
    return ok({ items: solutions, count: solutions.length });
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
    return ok({ created: true, solution: { id: solution.id, name: solution.name, slug: (solution as { slug?: string }).slug ?? null } });
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
