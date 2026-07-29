import { ToolContext, ToolResult, err } from './tools/context.js';
import { toErrorResponse } from './errors.js';

/**
 * Central allow/deny enforcement, run before every tool handler. Governance requires the allowlist to be
 * enforced on ALL calls (not just the handful of write tools that opted in), so this resolves whatever
 * solution/application a call targets — directly from the args, or by resolving a report/widget id — and
 * blocks anything outside `SMARTSUITE_ALLOWED_SOLUTIONS` / `SMARTSUITE_ALLOWED_APPLICATIONS` (or in
 * `SMARTSUITE_DENIED_APPLICATIONS`). Resolution lookups only run when an allowlist is configured, so
 * vanilla (unrestricted) mode stays a cheap no-op aside from the denylist.
 */

const strArg = (args: Record<string, unknown>, k: string): string | undefined =>
  typeof args[k] === 'string' && (args[k] as string).length > 0 ? (args[k] as string) : undefined;

export async function enforceAccess(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  const { allowedSolutions, allowedApplications, deniedApplications } = ctx.config;
  const restricted = allowedSolutions.length > 0 || allowedApplications.length > 0;

  // A raw file handle is not scoped to any solution, so under an allowlist it could reach files in
  // solutions the user isn't allowed to see. Disable handle-based file access in restricted mode.
  if (restricted && toolName === 'smartsuite_get_file_url') {
    return err('APPLICATION_DENIED', 'get_file_url takes a raw file handle that is not scoped to a solution, so it is disabled while a solution/application allowlist is configured.');
  }

  let applicationId = strArg(args, 'applicationId');
  let solutionId = strArg(args, 'solutionId');

  // Tools identified only by a report/widget id (update_view, delete_dashboard, widget ops, …) don't carry
  // applicationId/solutionId. Resolve them so the allowlist still applies. Only under an allowlist.
  if (restricted && !applicationId) {
    try {
      const reportId = strArg(args, 'viewId') ?? strArg(args, 'dashboardId') ?? strArg(args, 'reportId');
      if (reportId) {
        const r = await ctx.client.getReport(reportId);
        applicationId = r.application; solutionId = solutionId ?? (r.solution ?? undefined);
      } else {
        const widgetId = strArg(args, 'widgetId');
        if (widgetId) {
          const w = await ctx.client.getWidget(widgetId);
          if (w?.report) { const r = await ctx.client.getReport(w.report as string); applicationId = r.application; solutionId = solutionId ?? (r.solution ?? undefined); }
        }
      }
    } catch (e) {
      return err('APPLICATION_DENIED', `Access denied: could not verify which solution/application this request targets (${toErrorResponse(e).message}).`);
    }
  }

  if (solutionId && allowedSolutions.length > 0 && !allowedSolutions.includes(solutionId)) {
    return err('APPLICATION_DENIED', `Solution ${solutionId} is not in the allowed solutions list.`);
  }

  if (applicationId) {
    if (deniedApplications.includes(applicationId)) {
      return err('APPLICATION_DENIED', `Application ${applicationId} is not accessible.`);
    }
    if (allowedApplications.length > 0 && !allowedApplications.includes(applicationId)) {
      return err('APPLICATION_DENIED', `Application ${applicationId} is not in the allowed applications list.`);
    }
    // The application must live in an allowed solution — resolve its solution (cached) and check.
    if (allowedSolutions.length > 0) {
      try {
        const schema = await ctx.client.getApplicationSchema(applicationId);
        const sol = (schema as { solution?: string }).solution;
        if (!sol || !allowedSolutions.includes(sol)) {
          return err('APPLICATION_DENIED', `Application ${applicationId} is not in an allowed solution.`);
        }
      } catch (e) {
        return err('APPLICATION_DENIED', `Access denied: could not verify the solution for application ${applicationId} (${toErrorResponse(e).message}).`);
      }
    }
  }

  return null;
}
