import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';
import { proseMirrorToText } from '../utils/prosemirror.js';

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
