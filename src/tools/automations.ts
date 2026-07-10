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

/**
 * Parse the engine-computed `system_status` into a state + human reason. Observed shapes:
 *   { enabled: "SYSTEM_ENABLED" }                        → enabled
 *   { pending: { message: "created" | "updated" } }       → pending (async; re-fetch to resolve)
 *   { disabled: { message: "..." }, error: { ... } }      → disabled, with the reason it won't run
 * `system_status` is computed by the engine, NOT an input we set — an automation goes disabled when it's
 * structurally invalid (missing credential, incomplete action, etc.), not because a flag was dropped.
 */
export function automationStatus(a: Automation): { state: 'enabled' | 'disabled' | 'pending' | 'unknown'; reason: string | null } {
  const s = a.system_status as unknown;
  if (s == null || typeof s !== 'object') {
    if (typeof s === 'string' && /ENABLED|ON|ACTIVE/i.test(s)) return { state: 'enabled', reason: null };
    if (typeof s === 'string' && /DISABLED|OFF/i.test(s)) return { state: 'disabled', reason: null };
    return { state: 'unknown', reason: null };
  }
  const o = s as Record<string, any>;
  const reasonOf = (v: unknown): string | null =>
    (v && typeof v === 'object' && typeof (v as any).message === 'string') ? (v as any).message : null;
  if ('disabled' in o || 'error' in o) return { state: 'disabled', reason: reasonOf(o['error']) ?? reasonOf(o['disabled']) };
  if ('pending' in o) return { state: 'pending', reason: reasonOf(o['pending']) };
  if (typeof o['enabled'] === 'string') {
    return /DISABLED|OFF/i.test(o['enabled']) ? { state: 'disabled', reason: null } : { state: 'enabled', reason: null };
  }
  return { state: 'unknown', reason: null };
}

function isEnabled(a: Automation): boolean | null {
  const { state } = automationStatus(a);
  if (state === 'enabled') return true;
  if (state === 'disabled') return false;
  return null; // pending / unknown
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
  const status = automationStatus(a);
  return {
    id: a.automation_id,
    name: a.label ?? null,
    enabled: isEnabled(a),
    status: status.state,
    ...(status.reason ? { statusReason: status.reason } : {}),
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

/** Shape GetLimits into a usage view with derived remaining/percent. */
export function summarizeLimits(raw: { plan_category?: string; limit?: number; usage?: number; enforceLimit?: boolean }): Record<string, unknown> {
  const limit = typeof raw.limit === 'number' ? raw.limit : null;
  const usage = typeof raw.usage === 'number' ? raw.usage : null;
  const remaining = limit !== null && usage !== null ? Math.max(0, limit - usage) : null;
  const percentUsed = limit && usage !== null ? Math.round((usage / limit) * 1000) / 10 : null;
  return {
    planCategory: raw.plan_category ?? null,
    automationRunLimit: limit,
    automationRunsUsed: usage,
    remaining,
    percentUsed,
    enforced: raw.enforceLimit ?? null,
  };
}

export async function handleGetAutomationLimits(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const raw = await ctx.client.getLimits();
    return ok(summarizeLimits(raw));
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/** Slim an automation credential to its integration + label. */
function slimCredential(c: Record<string, any>): Record<string, unknown> {
  const ref = c['authentication_method_reference'] ?? {};
  const userId = c['metadata']?.metadata?.userId ?? null;
  return {
    credentialId: c['credential_id'],
    integrationId: ref['integration_id'] ?? null,
    authMethod: ref['authentication_method_id'] ?? null,
    label: c['label'] ?? null,
    ...(userId ? { userId } : {}),
  };
}

export async function handleListAutomationCredentials(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  try {
    const creds = await ctx.client.listAutomationCredentials(solutionId);
    const items = creds.map(slimCredential);
    const integrations = [...new Set(items.map((i) => i['integrationId']).filter(Boolean))];
    return ok({ solutionId, count: items.length, integrations, items });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/** Slim a solution member to identity fields. */
function slimMember(m: Record<string, any>): Record<string, unknown> {
  const email = Array.isArray(m['email']) ? m['email'][0] ?? null : m['email'] ?? null;
  return {
    memberId: m['member_id'],
    name: m['name'] ?? null,
    email,
    jobTitle: m['job_title'] ?? null,
    status: m['status'] ?? null,
  };
}

export async function handleListSolutionMembers(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  try {
    const members = await ctx.client.listSolutionMembers(solutionId);
    return ok({ solutionId, count: members.length, members: members.map(slimMember) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/** Flatten an automation's nested action groups into a single ordered list of actions. */
export function flattenActions(automation: Automation): Array<Record<string, any>> {
  const groups = Array.isArray(automation.action_groups) ? automation.action_groups : [];
  const out: Array<Record<string, any>> = [];
  for (const g of groups as Array<Record<string, unknown>>) {
    const inner = g['actions'] as Record<string, unknown> | undefined;
    const arr = Array.isArray((inner as Record<string, unknown>)?.['actions'])
      ? ((inner as Record<string, unknown>)['actions'] as Array<Record<string, any>>)
      : [];
    out.push(...arr);
  }
  return out;
}

/** Slim a resolved input descriptor: label, type, required, and select/status/tag options. */
function slimInput(i: Record<string, any>): Record<string, unknown> {
  const editor = i['editor'] ?? {};
  const opts = editor['select']?.options ?? editor['status']?.options ?? editor['tag']?.options;
  return {
    inputId: i['input_id'],
    label: i['label'] ?? null,
    type: i['value']?.type ?? i['value_description']?.type ?? null,
    required: i['display']?.show_required_status === 'REQUIRED' || i['editor']?.required === true || undefined,
    ...(Array.isArray(opts) ? { options: opts.map((o: any) => ({ value: o.value, label: o.label })) } : {}),
  };
}

/** Slim a field/output descriptor down to id, label, and types. */
function slimField(f: Record<string, any>): Record<string, unknown> {
  return {
    outputId: f['output_id'] ?? f['condition_field_id'] ?? null,
    label: f['label'] ?? null,
    type: f['value']?.type ?? null,
    smartsuiteFieldType: f['smartsuite_field_type'] ?? undefined,
    labelSuffix: f['label_suffix'] ?? undefined,
  };
}

export async function handleDescribeAutomationStep(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  const automationId = args['automationId'] as string;
  const step = (args['step'] as string) === 'action' ? 'action' : 'trigger';
  try {
    const automations = await ctx.client.listAutomations(solutionId);
    const automation = automations.find((a) => a.automation_id === automationId);
    if (!automation) return err('SMARTSUITE_NOT_FOUND', `Automation "${automationId}" not found in solution ${solutionId}`);

    if (step === 'trigger') {
      if (!automation.trigger) return err('SMARTSUITE_VALIDATION_ERROR', 'This automation has no trigger to describe.');
      const t = await ctx.client.describeAutomationTrigger(automation.trigger, solutionId);
      return ok({
        step: 'trigger',
        triggerId: t['trigger_id'] ?? null,
        label: t['label'] ?? null,
        inputs: Array.isArray(t['inputs']) ? (t['inputs'] as any[]).map(slimInput) : [],
        outputs: Array.isArray(t['outputs']) ? (t['outputs'] as any[]).map(slimField) : [],
        exposedFields: Array.isArray((t['record_list_output'] as any)?.fields) ? (t['record_list_output'] as any).fields.map(slimField) : [],
        conditionFields: Array.isArray(t['condition_fields']) ? (t['condition_fields'] as any[]).map(slimField) : [],
      });
    }

    // step === 'action': locate the action by instance id or flat index (default first).
    const actions = flattenActions(automation);
    if (!actions.length) return err('SMARTSUITE_VALIDATION_ERROR', 'This automation has no actions to describe.');
    const instanceId = args['actionInstanceId'];
    const index = typeof args['actionIndex'] === 'number' ? (args['actionIndex'] as number) : 0;
    const action = instanceId !== undefined
      ? actions.find((a) => a['action_reference']?.instance_id === instanceId)
      : actions[index];
    if (!action) {
      return err('SMARTSUITE_NOT_FOUND', `No matching action. This automation has ${actions.length} action(s); pass actionIndex (0-${actions.length - 1}) or a valid actionInstanceId.`);
    }
    const a = await ctx.client.describeAutomationAction(action, solutionId);
    return ok({
      step: 'action',
      actionId: a['action_id'] ?? null,
      label: a['label'] ?? null,
      integrationId: action['action_reference']?.integration_id ?? null,
      inputs: Array.isArray(a['inputs']) ? (a['inputs'] as any[]).map(slimInput) : [],
      ...(Array.isArray(a['outputs']) ? { outputs: (a['outputs'] as any[]).map(slimField) } : {}),
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── Write: create / update / delete ──────────────────────────────────────────

/** Automation writes are structural config — gated like other schema writes. */
function writeGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Automation writes are blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Automation writes are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to enable creating/updating automations.');
  }
  return null;
}

/**
 * Resolve action_groups from args. Accepts either the native nested shape via `actionGroups`
 * (`[{actions:{actions:[...]}}]`, passed through), or a flat `actions` array which is wrapped
 * into a single group. Returns [] when neither is provided.
 */
export function normalizeActionGroups(args: Record<string, unknown>): unknown[] {
  const groups = args['actionGroups'];
  if (Array.isArray(groups)) return groups;
  const actions = args['actions'];
  if (Array.isArray(actions)) return actions.length ? [{ actions: { actions } }] : [];
  return [];
}

/**
 * Fill a credential_id onto the trigger and every action that lacks one. Callers building a
 * spec from describe_automation_step won't know the credential id; this lets them pass one once.
 * Returns a deep clone — never mutates the caller's objects.
 */
export function injectCredential(
  automation: Record<string, any>,
  credentialId: string | undefined,
): Record<string, any> {
  const a = JSON.parse(JSON.stringify(automation));
  if (!credentialId) return a;
  if (a.trigger && a.trigger.credential_id == null) a.trigger.credential_id = credentialId;
  for (const g of Array.isArray(a.action_groups) ? a.action_groups : []) {
    const arr = Array.isArray(g?.actions?.actions) ? g.actions.actions : [];
    for (const act of arr) if (act.credential_id == null) act.credential_id = credentialId;
  }
  return a;
}

/**
 * The engine validates an automation asynchronously, so right after a write `status` is usually
 * "pending". Surface a note so the caller re-checks rather than assuming the write settled the state —
 * and, when already disabled, that the write itself did not "turn it off": it's structurally invalid.
 */
function statusNote(summary: Record<string, unknown> | null): Record<string, unknown> {
  const state = summary?.['status'];
  if (state === 'pending') {
    return { note: 'system_status is validated asynchronously and is still "pending". Re-run describe_automation shortly to see the final enabled/disabled state and, if disabled, the reason.' };
  }
  if (state === 'disabled') {
    const reason = summary?.['statusReason'];
    return { note: `Automation is disabled${reason ? ` because: ${reason}` : ''}. This is the engine rejecting an invalid automation (e.g. missing credential or incomplete action) — not the write clearing an "enabled" flag. Fix the cause; enabled state is computed, not set directly.` };
  }
  return {};
}

/** Re-fetch the automation after a write so the response reflects the saved state. */
async function fetchSummary(ctx: ToolContext, solutionId: string, automationId: string): Promise<Record<string, unknown> | null> {
  try {
    const automations = await ctx.client.listAutomations(solutionId);
    const found = automations.find((a) => a.automation_id === automationId);
    return found ? slimAutomation(found) : null;
  } catch {
    return null;
  }
}

export async function handleCreateAutomation(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const solutionId = args['solutionId'] as string;
  const label = args['label'] as string;
  const trigger = args['trigger'] as Record<string, any> | undefined;
  if (!solutionId) return err('SMARTSUITE_VALIDATION_ERROR', 'solutionId is required.');
  if (!label?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'label is required.');
  if (!trigger || typeof trigger !== 'object') {
    return err('SMARTSUITE_VALIDATION_ERROR', 'trigger is required (an object with trigger_reference.trigger_id and inputs). Use describe_automation_step on an existing automation to learn the shape.');
  }
  if (!trigger.trigger_reference?.trigger_id) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'trigger.trigger_reference.trigger_id is required.');
  }

  const core: Record<string, unknown> = {
    solution_id: solutionId,
    label,
    trigger,
    action_groups: normalizeActionGroups(args),
  };
  if (typeof args['automaticDescription'] === 'string') core['automatic_description'] = args['automaticDescription'];
  if (typeof args['timezone'] === 'string') core['timezone'] = args['timezone'];

  const payload = injectCredential(core, args['credentialId'] as string | undefined);
  try {
    const res = await ctx.client.createAutomation(payload);
    const automationId = res['automation_id'] as string;
    const summary = automationId ? await fetchSummary(ctx, solutionId, automationId) : null;
    return ok({ created: true, automationId: automationId ?? null, firstCreated: res['first_created'] ?? null, automation: summary, ...statusNote(summary) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleUpdateAutomation(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const solutionId = args['solutionId'] as string;
  const automationId = args['automationId'] as string;
  if (!solutionId) return err('SMARTSUITE_VALIDATION_ERROR', 'solutionId is required.');
  if (!automationId) return err('SMARTSUITE_VALIDATION_ERROR', 'automationId is required.');

  try {
    const automations = await ctx.client.listAutomations(solutionId);
    const existing = automations.find((a) => a.automation_id === automationId);
    if (!existing) return err('SMARTSUITE_NOT_FOUND', `Automation "${automationId}" not found in solution ${solutionId}`);

    // Rebuild the update payload from the known automation fields, applying only provided overrides.
    const core: Record<string, unknown> = {
      automation_id: automationId,
      solution_id: solutionId,
      label: typeof args['label'] === 'string' ? args['label'] : existing.label,
      trigger: args['trigger'] ?? existing.trigger,
      action_groups: args['actionGroups'] !== undefined || args['actions'] !== undefined
        ? normalizeActionGroups(args)
        : existing.action_groups ?? [],
      first_created: existing.first_created,
    };
    const desc = typeof args['automaticDescription'] === 'string' ? args['automaticDescription'] : existing.automatic_description;
    if (desc !== undefined) core['automatic_description'] = desc;
    const tz = typeof args['timezone'] === 'string' ? args['timezone'] : existing.timezone;
    if (tz !== undefined) core['timezone'] = tz;

    const payload = injectCredential(core, args['credentialId'] as string | undefined);
    const res = await ctx.client.updateAutomation(payload);
    const summary = await fetchSummary(ctx, solutionId, automationId);
    return ok({ updated: true, automationId, lastUpdated: res['last_updated'] ?? null, automation: summary, ...statusNote(summary) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleDeleteAutomation(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  if (!ctx.config.enableDelete) {
    return err('MCP_MODE_BLOCKED', 'Delete is disabled. Set SMARTSUITE_ENABLE_DELETE=true to enable.');
  }

  const solutionId = args['solutionId'] as string;
  const automationId = args['automationId'] as string;
  const confirm = (args['confirm'] as boolean | undefined) ?? false;
  if (!solutionId) return err('SMARTSUITE_VALIDATION_ERROR', 'solutionId is required.');
  if (!automationId) return err('SMARTSUITE_VALIDATION_ERROR', 'automationId is required.');

  try {
    const automations = await ctx.client.listAutomations(solutionId);
    const existing = automations.find((a) => a.automation_id === automationId);
    if (!existing) return err('SMARTSUITE_NOT_FOUND', `Automation "${automationId}" not found in solution ${solutionId}`);

    if (!confirm) {
      return ok({
        deleted: false,
        confirmationRequired: true,
        message: `This will permanently delete automation "${existing.label ?? automationId}". Re-call with confirm:true to proceed.`,
        automation: slimAutomation(existing),
      });
    }

    await ctx.client.deleteAutomation(automationId, solutionId);
    return ok({ deleted: true, automationId, label: existing.label ?? null });
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
