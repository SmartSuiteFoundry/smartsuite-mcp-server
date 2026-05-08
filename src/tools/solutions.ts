import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';

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
    return ok(solution);
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
