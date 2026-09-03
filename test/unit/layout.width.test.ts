import { describe, it, expect } from 'vitest';
import { removeFieldFromLayout, orphanedLayoutSlugs, handleRemoveLayoutField, handleMoveLayoutField } from '../../src/tools/layout.js';
import { normalizeField } from '../../src/tools/applications.js';

const parse = (r: any) => JSON.parse(r.content[0].text);

const layout = () => ({
  mode: 'fifty_fifty',
  fifty_fifty: { rows: [['title', ''], ['gone', 'status'], ['ghost', '']], sections: [] as any[] },
  seventy_thirty: { seventy: ['title', 'ghost'], thirty: ['status'], seventy_sections: [], thirty_sections: [] },
  single_column: { rows: ['title', 'gone', 'status', 'ghost'], sections: [] as any[] },
  tabs: { enabled: false, tabs: [] as any[] },
});

// Two of these placements have no matching field — the residue of a deleted field.
const structure = [
  { slug: 'title', label: 'Title', field_type: 'textfield', params: { width: 1, primary: true } },
  { slug: 'status', label: 'Status', field_type: 'statusfield', params: { width: 2 } },
];

const mkCtx = (over: any = {}) => {
  let saved: any = null;
  const app = { id: 'app1', structure, structure_layout: layout(), ...(over.app ?? {}) };
  return {
    ctx: {
      config: { mode: 'admin', accountId: 'a', enableSchemaWrite: true, allowedApplications: [], deniedApplications: [], ...(over.config ?? {}) },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      client: {
        getApplication: async () => JSON.parse(JSON.stringify(app)),
        updateApplicationLayout: async (_id: string, l: any) => { saved = l; return { ...app, structure_layout: l }; },
        changeField: async (_id: string, f: any) => { saved = f; return f; },
      },
    } as any,
    saved: () => saved,
  };
};

describe('orphanedLayoutSlugs', () => {
  it('finds placements whose field no longer exists, ignoring section markers', () => {
    const l = layout();
    l.fifty_fifty.rows.push(['section__s1', '']);
    expect(orphanedLayoutSlugs(l, ['title', 'status'])).toEqual(['ghost', 'gone']);
  });

  it('scans tab layouts too', () => {
    const l: any = layout();
    l.tabs = { enabled: true, tabs: [{ id: 'T1', name: 'T', position: 0, layout: { fifty_fifty: { rows: [['tabghost', '']], sections: [] } } }] };
    expect(orphanedLayoutSlugs(l, ['title', 'status'])).toContain('tabghost');
  });

  it('returns nothing when every placement resolves', () => {
    expect(orphanedLayoutSlugs(layout(), ['title', 'status', 'gone', 'ghost'])).toEqual([]);
  });
});

describe('removeFieldFromLayout', () => {
  it('strips the slug from pair rows, flat rows, and seventy/thirty', () => {
    const { layout: out, found } = removeFieldFromLayout(layout(), 'ghost');
    expect(found).toBe(true);
    expect(out.fifty_fifty.rows).toEqual([['title', ''], ['gone', 'status']]); // emptied pair row dropped
    expect(out.single_column.rows).toEqual(['title', 'gone', 'status']);
    expect(out.seventy_thirty.seventy).toEqual(['title']);
  });

  it('blanks one slot without dropping a row that still holds a field', () => {
    const out = removeFieldFromLayout(layout(), 'gone').layout;
    expect(out.fifty_fifty.rows).toContainEqual(['', 'status']);
  });

  it('reports not-found without mutating the input', () => {
    const input = layout();
    const { found } = removeFieldFromLayout(input, 'nope');
    expect(found).toBe(false);
    expect(input.fifty_fifty.rows).toHaveLength(3);
  });
});

describe('handleRemoveLayoutField', () => {
  it('requires slug or removeOrphans', async () => {
    const { ctx } = mkCtx();
    const out = parse(await handleRemoveLayoutField({ applicationId: 'app1' }, ctx));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(out.error.message).toContain('removeOrphans');
  });

  it('previews an orphan sweep and lists what it would clear', async () => {
    const { ctx } = mkCtx();
    const out = parse(await handleRemoveLayoutField({ applicationId: 'app1', removeOrphans: true }, ctx));
    expect(out).toMatchObject({ dryRun: true, wouldRemove: ['ghost', 'gone'] });
  });

  it('clears orphans on confirm and reports none remaining', async () => {
    const { ctx } = mkCtx();
    const out = parse(await handleRemoveLayoutField({ applicationId: 'app1', removeOrphans: true, confirm: true }, ctx));
    expect(out).toMatchObject({ removed: true, slugs: ['ghost', 'gone'], remainingOrphans: [] });
  });

  it('warns when the slug is a live field, since removing it hides the field', async () => {
    const { ctx } = mkCtx();
    const out = parse(await handleRemoveLayoutField({ applicationId: 'app1', slug: 'status' }, ctx));
    expect(out.warning).toContain('hides');
    expect(out.orphansFound).toEqual(['ghost', 'gone']);
  });

  it('404s a slug that is not placed anywhere', async () => {
    const { ctx } = mkCtx();
    expect(parse(await handleRemoveLayoutField({ applicationId: 'app1', slug: 'nope' }, ctx)).error.code).toBe('SMARTSUITE_NOT_FOUND');
  });

  it('reports nothing to do when there are no orphans', async () => {
    const { ctx } = mkCtx({ app: { structure: [...structure, { slug: 'gone', label: 'G', field_type: 'textfield', params: {} }, { slug: 'ghost', label: 'H', field_type: 'textfield', params: {} }] } });
    const out = parse(await handleRemoveLayoutField({ applicationId: 'app1', removeOrphans: true }, ctx));
    expect(out).toMatchObject({ removed: false, orphans: [] });
  });

  it('is blocked without schema write', async () => {
    const { ctx } = mkCtx({ config: { enableSchemaWrite: false } });
    expect(parse(await handleRemoveLayoutField({ applicationId: 'app1', removeOrphans: true }, ctx)).error.code).toBe('MCP_MODE_BLOCKED');
  });
});

describe('handleMoveLayoutField — fullWidth', () => {
  it('changes only the span when no destination is given, leaving row order alone', async () => {
    const { ctx, saved } = mkCtx();
    const out = parse(await handleMoveLayoutField({ applicationId: 'app1', slug: 'title', fullWidth: true, confirm: true }, ctx));
    expect(out).toMatchObject({ slug: 'title', fullWidth: true, widthChanged: true });
    expect(saved().params.width).toBe(2);          // wrote the field...
    expect(saved().slug).toBe('title');            // ...not the layout
  });

  it('previews the width transition', async () => {
    const { ctx } = mkCtx();
    const out = parse(await handleMoveLayoutField({ applicationId: 'app1', slug: 'title', fullWidth: true }, ctx));
    expect(out).toMatchObject({ dryRun: true, wouldSetWidth: '1 -> 2' });
    expect(out.wouldMove).toBeUndefined();
  });

  it('writes nothing when the field already has that span', async () => {
    const { ctx, saved } = mkCtx();
    const out = parse(await handleMoveLayoutField({ applicationId: 'app1', slug: 'status', fullWidth: true, confirm: true }, ctx));
    expect(out.widthChanged).toBe(false);
    expect(saved()).toBeNull();
  });

  it('applies the span alongside a reorder when afterField is given', async () => {
    const { ctx } = mkCtx();
    const out = parse(await handleMoveLayoutField({ applicationId: 'app1', slug: 'title', afterField: 'status', fullWidth: true, confirm: true }, ctx));
    expect(out).toMatchObject({ moved: true, widthChanged: true, width: 2 });
  });
});

describe('normalizeField — fullWidth', () => {
  it('surfaces a full-width span at standard verbosity, and stays quiet at half width', () => {
    expect(normalizeField({ slug: 's', label: 'S', field_type: 'textfield', params: { width: 2 } } as any)).toMatchObject({ fullWidth: true });
    expect(normalizeField({ slug: 's', label: 'S', field_type: 'textfield', params: { width: 1 } } as any)).not.toHaveProperty('fullWidth');
    expect(normalizeField({ slug: 's', label: 'S', field_type: 'textfield', params: {} } as any)).not.toHaveProperty('fullWidth');
  });

  it('omits it from compact output', () => {
    expect(normalizeField({ slug: 's', label: 'S', field_type: 'textfield', params: { width: 2 } } as any, 'compact')).not.toHaveProperty('fullWidth');
  });
});
