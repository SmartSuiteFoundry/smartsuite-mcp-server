import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { Automation } from '../types/smartsuite.js';

/** Summarize an automation's trigger to a readable reference. */
function triggerSummary(a: Automation): Record<string, unknown> | null {
  const t = a.trigger;
  if (!t) return null;
  return {
    integrationId: t.trigger_reference?.integration_id ?? null,
    triggerId: t.trigger_reference?.trigger_id ?? null,
  };
}

function isEnabled(a: Automation): boolean | null {
  const s = a.system_status as unknown;
  if (s == null) return null;
  // system_status is an object like { enabled: "SYSTEM_ENABLED" | "SYSTEM_DISABLED" }.
  const flag = typeof s === 'object' ? (s as Record<string, unknown>)['enabled'] : s;
  if (typeof flag !== 'string') return null;
  if (/DISABLED|OFF/i.test(flag)) return false;
  return /ENABLED|ON|ACTIVE/i.test(flag) ? true : null;
}

function actionTypes(a: Automation): string[] {
  const groups = Array.isArray(a.action_groups) ? a.action_groups : [];
  const types: string[] = [];
  for (const g of groups as Array<Record<string, unknown>>) {
    // Each group is { actions: { actions: [ { action_reference: { action_id } } ] } }.
    const inner = g['actions'] as Record<string, unknown> | unknown[] | undefined;
    const arr = Array.isArray(inner)
      ? inner
      : (Array.isArray((inner as Record<string, unknown>)?.['actions'])
          ? ((inner as Record<string, unknown>)['actions'] as unknown[])
          : []);
    for (const act of arr as Array<Record<string, unknown>>) {
      const ref = act['action_reference'] as Record<string, unknown> | undefined;
      const id = (ref?.['action_id'] ?? act['action_id'] ?? act['type']) as string | undefined;
      if (id) types.push(id);
    }
  }
  return types;
}

function slimAutomation(a: Automation): Record<string, unknown> {
  const actions = actionTypes(a);
  return {
    id: a.automation_id,
    name: a.label ?? null,
    enabled: isEnabled(a),
    trigger: triggerSummary(a),
    actionCount: actions.length,
    actionTypes: actions,
  };
}

export async function handleListAutomations(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  try {
    const automations = await ctx.client.listAutomations(solutionId);
    const items = automations.map(slimAutomation);
    return ok({ items, count: items.length });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleDescribeAutomation(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  const automationId = args['automationId'] as string;
  try {
    const automations = await ctx.client.listAutomations(solutionId);
    const automation = automations.find((a) => a.automation_id === automationId);
    if (!automation) {
      return err('SMARTSUITE_NOT_FOUND', `Automation "${automationId}" not found in solution ${solutionId}`);
    }
    // Slim summary plus the full trigger and action groups for detailed inspection.
    return ok({
      ...slimAutomation(automation),
      solutionId: automation.solution_id ?? solutionId,
      timezone: automation.timezone ?? null,
      triggerConfig: automation.trigger ?? null,
      actionGroups: automation.action_groups ?? [],
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
