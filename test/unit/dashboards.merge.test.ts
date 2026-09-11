import { describe, it, expect } from 'vitest';
import { handleUpdateDashboardWidget } from '../../src/tools/dashboards.write.js';

const parse = (r: any) => JSON.parse(r.content[0].text);
const mkCtx = (existingParams: any) => {
  let sent: any = null;
  return {
    ctx: {
      config: { mode: 'admin', accountId: 'a', enableSchemaWrite: true },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      client: {
        getWidget: async () => ({ id: 'w1', params: existingParams }),
        updateWidget: async (_id: string, p: any) => { sent = p; return { id: 'w1', ...p }; },
      },
    } as any,
    sent: () => sent,
  };
};

describe('update_dashboard_widget merges params', () => {
  // The API replaces params wholesale: a partial patch 400s with "Field required" for everything
  // omitted, and a plausible-looking full blob silently drops the data source.
  it('keeps the settings a partial patch does not name', async () => {
    const { ctx, sent } = mkCtx({ application: 'app1', values: ['a'], group_by: ['b'], chart_type: 'donut' });
    const out = parse(await handleUpdateDashboardWidget({ widgetId: 'w1', params: { chart_type: 'bar' } }, ctx));
    expect(out.updated).toBe(true);
    expect(sent().params).toEqual({ application: 'app1', values: ['a'], group_by: ['b'], chart_type: 'bar' });
  });

  it('lets the patch win on keys it does name', async () => {
    const { ctx, sent } = mkCtx({ chart_type: 'donut', totals: false });
    await handleUpdateDashboardWidget({ widgetId: 'w1', params: { totals: true } }, ctx);
    expect(sent().params).toMatchObject({ chart_type: 'donut', totals: true });
  });

  it('passes a non-object params through untouched', async () => {
    const { ctx, sent } = mkCtx({ a: 1 });
    await handleUpdateDashboardWidget({ widgetId: 'w1', params: 'raw' }, ctx);
    expect(sent().params).toBe('raw');
  });

  it('does not read the widget when params are not being changed', async () => {
    const { ctx, sent } = mkCtx({ a: 1 });
    await handleUpdateDashboardWidget({ widgetId: 'w1', color: '#F1273F' }, ctx);
    expect(sent()).toEqual({ color: '#F1273F' });
  });
});
