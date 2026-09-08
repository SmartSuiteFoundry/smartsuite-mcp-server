import { describe, it, expect } from 'vitest';
import { normalizeField, handleCreateApplication } from '../../src/tools/applications.js';
import type { FieldDefinition } from '../../src/types/smartsuite.js';

const field = (over: Partial<FieldDefinition> & { params?: Record<string, any> } = {}): FieldDefinition =>
  ({
    slug: 's1',
    label: 'Title',
    field_type: 'textfield',
    params: {},
    ...over,
  }) as FieldDefinition;

describe('normalizeField token-lean projection', () => {
  it('omits false flags and null help (de-noise) in standard mode', () => {
    const out = normalizeField(field());
    expect(out).toEqual({ slug: 's1', label: 'Title', type: 'textfield' });
    expect(out).not.toHaveProperty('required');
    expect(out).not.toHaveProperty('helpText');
  });

  it('includes flags only when true, help only when present', () => {
    const out = normalizeField(field({ params: { required: true, help_text: 'be brief' } }));
    expect(out.required).toBe(true);
    expect(out.helpText).toBe('be brief');
    expect(out).not.toHaveProperty('primary');
  });

  it('compact keeps options + linked-app but drops flags/help/display hints', () => {
    const out = normalizeField(
      field({
        params: {
          required: true,
          help_text: 'x',
          display_format: 'stars',
          choices: [{ value: 'a', label: 'A', value_color: '#fff' }],
          linked_application: 'app123',
        },
      }),
      'compact',
    );
    expect(out).toEqual({
      slug: 's1',
      label: 'Title',
      type: 'textfield',
      options: [{ value: 'a', label: 'A' }],
      linkedApplication: 'app123',
    });
  });

  it('full appends the raw params blob', () => {
    const out = normalizeField(field({ params: { max_length: 25 } }), 'full');
    expect((out.params as any).max_length).toBe(25);
  });
});

// ── Record term: the "Add <term>" button and grid/list widgets break on an empty one ──────────
describe('create_application record term', () => {
  const parse = (r: any) => JSON.parse(r.content[0].text);
  const mkCtx = (created: any, over: any = {}) => {
    const patches: any[] = [];
    return {
      ctx: {
        config: { mode: 'admin', accountId: 'a', enableSchemaWrite: true },
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        client: {
          createApplication: async () => created,
          updateApplication: async (_i: string, p: any) => { patches.push(p); return { ...created, ...p }; },
          ...(over.client ?? {}),
        },
      } as any,
      patches,
    };
  };
  const args = { name: 'T', solutionId: 's1', confirm: true };

  it('defaults to "Record" and does not patch when the server honoured it', async () => {
    const { ctx, patches } = mkCtx({ id: 'a1', name: 'T', record_term: 'record', structure: [] });
    const out = parse(await handleCreateApplication(args, ctx));
    expect(out.application.recordTerm).toBe('record');
    expect(out.application.recordTermRepaired).toBeUndefined();
    expect(patches).toEqual([]);
  });

  it('repairs a term the server returned empty', async () => {
    const { ctx, patches } = mkCtx({ id: 'a1', name: 'T', record_term: '', structure: [] });
    const out = parse(await handleCreateApplication(args, ctx));
    expect(out.application).toMatchObject({ recordTerm: 'record', recordTermRepaired: true });
    expect(patches).toEqual([{ record_term: 'record' }]);
  });

  it('preserves an explicit term through the repair path', async () => {
    const { ctx, patches } = mkCtx({ id: 'a1', name: 'T', record_term: '', structure: [] });
    const out = parse(await handleCreateApplication({ ...args, recordTerm: 'Request' }, ctx));
    expect(out.application.recordTerm).toBe('Request');
    expect(patches).toEqual([{ record_term: 'Request' }]);
  });

  it('warns loudly when the repair itself fails, rather than reporting a clean create', async () => {
    const { ctx } = mkCtx({ id: 'a1', name: 'T', record_term: '', structure: [] }, {
      client: { updateApplication: async () => { throw new Error('nope'); } },
    });
    const out = parse(await handleCreateApplication(args, ctx));
    expect(out.application.recordTermWarning).toContain('empty record term');
  });
});
