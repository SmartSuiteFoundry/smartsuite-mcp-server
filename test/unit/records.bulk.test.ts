import { describe, it, expect } from 'vitest';
import { SmartSuiteClient } from '../../src/smartSuiteClient.js';
import { handleUpdateRecords } from '../../src/tools/records.write.js';

const parse = (r: any) => JSON.parse(r.content[0].text);

const mkClient = (response: unknown) => {
  const client = new SmartSuiteClient(
    { baseUrl: 'https://example.invalid', apiKey: 'k', accountId: 'acct', requestTimeoutMs: 1000, retryCount: 0, schemaCacheTtlMs: 0 },
    { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as any,
  );
  (client as any).request = async () => response;
  return client;
};

const mkCtx = (client: any, over: any = {}) => ({
  config: {
    mode: 'readwrite',
    accountId: 'acct',
    maxBatchWrites: 25,
    allowedApplications: [],
    deniedApplications: [],
    ...(over.config ?? {}),
  },
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  client,
}) as any;

const run = (records: any, client: any, over: any = {}) =>
  handleUpdateRecords({ applicationId: 'app1', records, dryRun: false, confirm: true }, mkCtx(client, over));

describe('SmartSuiteClient.bulkUpdateRecords', () => {
  // The live endpoint answers with a bare array, not the {successful_items, failed_items} envelope
  // its type claims. Before 0.9.11 the raw array reached the handler and crashed it.
  it('normalizes the bare-array response into the envelope', async () => {
    const client = mkClient([{ id: 'r1', title: 'One' }, { id: 'r2', title: 'Two' }]);
    const res = await client.bulkUpdateRecords('app1', [{ id: 'r1' }, { id: 'r2' }]);
    expect(res.successful_items.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(res.failed_items).toEqual([]);
  });

  it('passes an envelope response through and fills in absent halves', async () => {
    const enveloped = await mkClient({ successful_items: [{ id: 'r1' }], failed_items: [{ index: 1, reason: 'nope' }] })
      .bulkUpdateRecords('app1', [{ id: 'r1' }, { id: 'r2' }]);
    expect(enveloped.successful_items).toHaveLength(1);
    expect(enveloped.failed_items).toEqual([{ index: 1, reason: 'nope' }]);

    const partial = await mkClient({}).bulkUpdateRecords('app1', [{ id: 'r1' }]);
    expect(partial).toEqual({ successful_items: [], failed_items: [] });
  });
});

describe('handleUpdateRecords', () => {
  it('reports the updated count instead of throwing on a bare-array response', async () => {
    const out = parse(await run([{ recordId: 'r1', fields: { title: 'One' } }], mkClient([{ id: 'r1', title: 'One' }])));
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({ dryRun: false, updated: 1, failed: 0, failures: [] });
  });

  it('surfaces ids the endpoint silently dropped as failures', async () => {
    const out = parse(await run(
      [{ recordId: 'r1', fields: { title: 'One' } }, { recordId: 'ghost', fields: { title: 'X' } }],
      mkClient([{ id: 'r1', title: 'One' }]),
    ));
    expect(out).toMatchObject({ updated: 1, failed: 1 });
    expect(out.failures[0]).toMatchObject({ index: 1, recordId: 'ghost' });
  });

  it('merges endpoint-reported failures with the diffed ones', async () => {
    const client = mkClient({ successful_items: [], failed_items: [{ index: 0, reason: 'validation' }] });
    const out = parse(await run([{ recordId: 'r1', fields: {} }], client));
    expect(out.failed).toBe(2);
    expect(out.failures.map((f: any) => f.reason)).toEqual(['validation', expect.stringContaining('not updated')]);
  });

  it('rejects a missing or empty records array before calling the API', async () => {
    const boom = { bulkUpdateRecords: async () => { throw new Error('should not be called'); } } as any;
    expect(parse(await run(undefined, boom)).error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(parse(await run([], boom)).error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
  });

  it('still gates on mode, batch cap, and confirm', async () => {
    const one = [{ recordId: 'r1', fields: { title: 'One' } }];
    const client = mkClient([{ id: 'r1' }]);
    expect(parse(await run(one, client, { config: { mode: 'readonly' } })).error.code).toBe('MCP_MODE_BLOCKED');
    expect(parse(await run(one, client, { config: { maxBatchWrites: 0 } })).error.code).toBe('LIMIT_EXCEEDED');
    const unconfirmed = await handleUpdateRecords({ applicationId: 'app1', records: one, dryRun: false }, mkCtx(client));
    expect(parse(unconfirmed).error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('defaults to a dry run that previews without calling the API', async () => {
    const boom = { bulkUpdateRecords: async () => { throw new Error('should not be called'); } } as any;
    const out = parse(await handleUpdateRecords({ applicationId: 'app1', records: [{ recordId: 'r1', fields: {} }] }, mkCtx(boom)));
    expect(out).toMatchObject({ dryRun: true, wouldUpdate: 1 });
  });
});
