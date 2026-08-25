import { describe, it, expect } from 'vitest';
import { parseFieldSpecs, fieldDefOf, handleCreateFields, MAX_BULK_FIELDS } from '../../src/tools/fields.js';
import { handleCreateApplication } from '../../src/tools/applications.js';

const parse = (r: any) => JSON.parse(r.content[0].text);

const mkCtx = (over: any = {}) => ({
  config: { mode: 'admin', enableSchemaWrite: true, ...(over.config ?? {}) },
  client: {
    addField: async () => undefined,
    getApplication: async () => ({ id: 'app1', structure: [] }),
    getApplicationSchema: async () => ({ structure: [] }),
    createApplication: async (body: any) => ({ id: 'newapp', name: body.name, structure: body.structure ?? [] }),
    ...(over.client ?? {}),
  },
}) as any;

describe('parseFieldSpecs', () => {
  it('generates a distinct slug per entry and defaults params to {}', () => {
    const out = parseFieldSpecs([{ fieldType: 'textfield', label: 'A' }, { fieldType: 'numberfield', label: 'B' }]) as any;
    expect(out.specs).toHaveLength(2);
    expect(out.specs[0].slug).toMatch(/^s[0-9a-f]{9}$/);
    expect(out.specs[0].slug).not.toBe(out.specs[1].slug);
    expect(out.specs[0].params).toEqual({});
  });

  it('rejects a non-array, an empty array, and over-cap batches', () => {
    expect(parseFieldSpecs(undefined)).toHaveProperty('error');
    expect(parseFieldSpecs([])).toHaveProperty('error');
    const tooMany = Array.from({ length: MAX_BULK_FIELDS + 1 }, (_, i) => ({ fieldType: 'textfield', label: `F${i}` }));
    expect((parseFieldSpecs(tooMany) as any).error).toContain(`maximum per call is ${MAX_BULK_FIELDS}`);
  });

  it('reports the offending index for a malformed entry', () => {
    expect((parseFieldSpecs([{ fieldType: 'textfield', label: 'ok' }, { label: 'no type' }]) as any).error).toContain('fields[1].fieldType');
    expect((parseFieldSpecs([{ fieldType: 'textfield' }]) as any).error).toContain('fields[0].label');
    expect((parseFieldSpecs(['nope']) as any).error).toContain('fields[0] must be an object');
  });

  it('copies params so the caller object is not mutated by later normalization', () => {
    const params = { choices: [{ label: 'A', value: 'a' }] };
    const out = parseFieldSpecs([{ fieldType: 'singleselectfield', label: 'Pick', params }]) as any;
    fieldDefOf(out.specs[0]);
    expect(params.choices[0]).not.toHaveProperty('value_color');
  });
});

describe('fieldDefOf', () => {
  it('normalizes select choices (colors/order assigned) via the shared path', () => {
    const spec = { slug: 's1', label: 'Pick', fieldType: 'singleselectfield', params: { choices: [{ label: 'A', value: 'a' }] } };
    expect((fieldDefOf(spec).params as any).choices[0].value_color).toBe('#0C41F3');
  });
});

describe('handleCreateFields', () => {
  const two = [{ fieldType: 'textfield', label: 'One' }, { fieldType: 'numberfield', label: 'Two' }];

  it('is blocked in readonly mode and when schema write is off', async () => {
    expect(parse(await handleCreateFields({ applicationId: 'a', fields: two }, mkCtx({ config: { mode: 'readonly' } }))).error.code).toBe('MCP_MODE_BLOCKED');
    expect(parse(await handleCreateFields({ applicationId: 'a', fields: two }, mkCtx({ config: { enableSchemaWrite: false } }))).error.code).toBe('MCP_MODE_BLOCKED');
  });

  it('previews without writing unless confirm:true', async () => {
    let calls = 0;
    const ctx = mkCtx({ client: { addField: async () => { calls++; } } });
    const out = parse(await handleCreateFields({ applicationId: 'a', fields: two }, ctx));
    expect(out.dryRun).toBe(true);
    expect(out.count).toBe(2);
    expect(calls).toBe(0);
  });

  it('creates every field with one add_field call each, then one schema read', async () => {
    const added: string[] = [];
    let reads = 0;
    const ctx = mkCtx({
      client: {
        addField: async (_app: string, f: any) => { added.push(f.slug); },
        getApplication: async () => {
          reads++;
          return { id: 'app1', structure: added.map((slug) => ({ slug, label: slug, field_type: 'textfield', params: {} })) };
        },
      },
    });
    const out = parse(await handleCreateFields({ applicationId: 'a', fields: two, confirm: true }, ctx));
    expect(added).toHaveLength(2);
    expect(reads).toBe(1);
    expect(out.created).toBe(2);
    expect(out.failed).toBe(0);
    expect(out).not.toHaveProperty('partial');
    expect(out.fields.every((f: any) => f.created === true)).toBe(true);
  });

  it('does not abort the batch on a failure — reports each field and flags partial', async () => {
    const landed: string[] = [];
    let n = 0;
    const ctx = mkCtx({
      client: {
        addField: async (_app: string, f: any) => {
          n++;
          if (n === 2) throw new Error('rate limited');
          landed.push(f.slug);
        },
        getApplication: async () => ({ id: 'app1', structure: landed.map((slug) => ({ slug, label: slug, field_type: 'textfield', params: {} })) }),
      },
    });
    const out = parse(await handleCreateFields({
      applicationId: 'a',
      fields: [{ fieldType: 'textfield', label: 'One' }, { fieldType: 'textfield', label: 'Two' }, { fieldType: 'textfield', label: 'Three' }],
      confirm: true,
    }, ctx));
    expect(n).toBe(3); // kept going past the failure
    expect(out.created).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.partial).toBe(true);
    const failedEntry = out.fields.find((f: any) => f.created === false);
    expect(failedEntry.label).toBe('Two');
    expect(failedEntry.error).toContain('rate limited');
  });

  it('treats the post-batch schema as the authority on what landed', async () => {
    // add_field returns an empty body, so a 200 that did not persist must still report created:false.
    const ctx = mkCtx({ client: { addField: async () => undefined, getApplication: async () => ({ id: 'app1', structure: [] }) } });
    const out = parse(await handleCreateFields({ applicationId: 'a', fields: two, confirm: true }, ctx));
    expect(out.created).toBe(0);
    expect(out.failed).toBe(2);
    expect(out.partial).toBe(true);
  });

  it('resolves aiPrompt slugs once against the existing schema and rejects unknown ones', async () => {
    let schemaReads = 0;
    const ctx = mkCtx({
      client: {
        getApplicationSchema: async () => { schemaReads++; return { structure: [{ slug: 'title', label: 'Title', field_type: 'textfield', params: {} }] }; },
      },
    });
    const good = parse(await handleCreateFields({
      applicationId: 'a',
      fields: [{ fieldType: 'textfield', label: 'S1', aiPrompt: 'Sum {{title}}' }, { fieldType: 'textfield', label: 'S2', aiPrompt: 'Also {{title}}' }],
    }, ctx));
    expect(good.dryRun).toBe(true);
    expect(schemaReads).toBe(1); // one fetch for the whole batch, not per field

    const bad = parse(await handleCreateFields({
      applicationId: 'a',
      fields: [{ fieldType: 'textfield', label: 'Bad', aiPrompt: 'Ref {{nosuchslug}}' }],
    }, ctx));
    expect(bad.error.message).toContain('nosuchslug');
  });

  it('validates the whole batch before writing anything', async () => {
    let calls = 0;
    const ctx = mkCtx({ client: { addField: async () => { calls++; } } });
    const out = parse(await handleCreateFields({
      applicationId: 'a',
      fields: [{ fieldType: 'textfield', label: 'fine' }, { fieldType: '', label: 'broken' }],
      confirm: true,
    }, ctx));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(calls).toBe(0);
  });
});

describe('handleCreateApplication with inline fields', () => {
  it('sends the supplied fields as structure in the single create call', async () => {
    let body: any;
    const ctx = mkCtx({
      client: {
        createApplication: async (b: any) => { body = b; return { id: 'newapp', name: b.name, structure: b.structure }; },
      },
    });
    const out = parse(await handleCreateApplication({
      name: 'T', solutionId: 'sol1', fields: [{ fieldType: 'textfield', label: 'A' }, { fieldType: 'numberfield', label: 'B' }], confirm: true,
    }, ctx));
    expect(body.structure).toHaveLength(2);
    expect(body.structure[0].label).toBe('A');
    expect(body.record_term).toBe('Record');
    expect(out.fieldsCreated).toBe(2);
    expect(out.fields.every((f: any) => f.created)).toBe(true);
  });

  it('omits structure entirely when no fields are supplied (server default applies)', async () => {
    let body: any;
    const ctx = mkCtx({ client: { createApplication: async (b: any) => { body = b; return { id: 'newapp', name: b.name, structure: [] }; } } });
    const out = parse(await handleCreateApplication({ name: 'T', solutionId: 'sol1', confirm: true }, ctx));
    expect(body).not.toHaveProperty('structure');
    expect(out).not.toHaveProperty('fields');
  });

  it('reports created:false for a supplied field the platform did not provision', async () => {
    const ctx = mkCtx({ client: { createApplication: async (b: any) => ({ id: 'newapp', name: b.name, structure: [] }) } });
    const out = parse(await handleCreateApplication({
      name: 'T', solutionId: 'sol1', fields: [{ fieldType: 'textfield', label: 'A' }], confirm: true,
    }, ctx));
    expect(out.fieldsCreated).toBe(0);
    expect(out.fields[0].created).toBe(false);
  });

  it('rejects aiPrompt on inline fields (nothing exists to reference yet)', async () => {
    const out = parse(await handleCreateApplication({
      name: 'T', solutionId: 'sol1', fields: [{ fieldType: 'textfield', label: 'A', aiPrompt: 'Hi {{title}}' }], confirm: true,
    }, mkCtx()));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(out.error.message).toContain('aiPrompt is not supported');
  });

  it('surfaces a malformed fields entry as a validation error, without creating the table', async () => {
    let created = false;
    const ctx = mkCtx({ client: { createApplication: async (b: any) => { created = true; return { id: 'x', name: b.name, structure: [] }; } } });
    const out = parse(await handleCreateApplication({ name: 'T', solutionId: 'sol1', fields: [{ label: 'no type' }], confirm: true }, ctx));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(created).toBe(false);
  });

  it('previews the inline fields without creating', async () => {
    let created = false;
    const ctx = mkCtx({ client: { createApplication: async () => { created = true; return { id: 'x', structure: [] }; } } });
    const out = parse(await handleCreateApplication({ name: 'T', solutionId: 'sol1', fields: [{ fieldType: 'textfield', label: 'A' }] }, ctx));
    expect(out.dryRun).toBe(true);
    expect(out.wouldCreate.fields).toHaveLength(1);
    expect(created).toBe(false);
  });
});
