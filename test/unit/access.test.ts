import { describe, it, expect } from 'vitest';
import { enforceAccess } from '../../src/access.js';

// App → solution map the mock client resolves against.
const APP_SOLUTION: Record<string, string> = { appA: 'solAllowed', appB: 'solOther' };
const REPORTS: Record<string, any> = { view1: { application: 'appA', solution: 'solAllowed' }, dash2: { application: 'appB', solution: 'solOther' } };
const WIDGETS: Record<string, any> = { wid1: { report: 'dash2' } };

function ctx(config: Partial<{ allowedSolutions: string[]; allowedApplications: string[]; deniedApplications: string[] }>) {
  return {
    config: { allowedSolutions: [], allowedApplications: [], deniedApplications: [], ...config },
    client: {
      getApplicationSchema: async (id: string) => ({ solution: APP_SOLUTION[id] }),
      getReport: async (id: string) => REPORTS[id],
      getWidget: async (id: string) => WIDGETS[id],
    },
  } as any;
}
const allowed = async (r: Awaited<ReturnType<typeof enforceAccess>>) => expect(r).toBeNull();
const blocked = async (r: Awaited<ReturnType<typeof enforceAccess>>) => { expect(r).not.toBeNull(); expect((r as any).isError).toBe(true); };

describe('enforceAccess — vanilla (no allowlist)', () => {
  it('allows any solution/application', async () => {
    await allowed(await enforceAccess('smartsuite_list_records', { applicationId: 'appB' }, ctx({})));
    await allowed(await enforceAccess('smartsuite_get_solution', { solutionId: 'solOther' }, ctx({})));
  });
  it('still enforces the denylist', async () => {
    await blocked(await enforceAccess('smartsuite_list_records', { applicationId: 'appB' }, ctx({ deniedApplications: ['appB'] })));
  });
  it('does not disable get_file_url', async () => {
    await allowed(await enforceAccess('smartsuite_get_file_url', { fileHandle: 'h' }, ctx({})));
  });
});

describe('enforceAccess — solution allowlist', () => {
  const c = () => ctx({ allowedSolutions: ['solAllowed'] });
  it('allows an allowed solutionId, blocks others', async () => {
    await allowed(await enforceAccess('smartsuite_list_automations', { solutionId: 'solAllowed' }, c()));
    await blocked(await enforceAccess('smartsuite_list_automations', { solutionId: 'solOther' }, c()));
  });
  it('allows an app in an allowed solution, blocks an app in another solution', async () => {
    await allowed(await enforceAccess('smartsuite_describe_application', { applicationId: 'appA' }, c()));
    await blocked(await enforceAccess('smartsuite_describe_application', { applicationId: 'appB' }, c()));
  });
  it('resolves report-id-only tools (viewId/dashboardId) to their solution', async () => {
    await allowed(await enforceAccess('smartsuite_update_view', { viewId: 'view1' }, c()));
    await blocked(await enforceAccess('smartsuite_delete_dashboard', { dashboardId: 'dash2' }, c()));
  });
  it('resolves widget-id-only tools via their report', async () => {
    await blocked(await enforceAccess('smartsuite_remove_dashboard_widget', { widgetId: 'wid1' }, c()));
  });
  it('disables get_file_url under an allowlist', async () => {
    await blocked(await enforceAccess('smartsuite_get_file_url', { fileHandle: 'h' }, c()));
  });
});

describe('enforceAccess — application allowlist', () => {
  const c = () => ctx({ allowedApplications: ['appA'] });
  it('allows an allowed app, blocks others (no solution resolution needed)', async () => {
    await allowed(await enforceAccess('smartsuite_list_records', { applicationId: 'appA' }, c()));
    await blocked(await enforceAccess('smartsuite_list_records', { applicationId: 'appB' }, c()));
  });
});

describe('enforceAccess — resolution failure denies', () => {
  it('blocks when a report id cannot be resolved', async () => {
    const c = ctx({ allowedSolutions: ['solAllowed'] });
    c.client.getReport = async () => { throw new Error('not found'); };
    await blocked(await enforceAccess('smartsuite_update_view', { viewId: 'ghost' }, c));
  });
});
