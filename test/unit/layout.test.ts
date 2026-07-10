import { describe, it, expect } from 'vitest';
import {
  generateSectionSlug, buildSectionDescription,
  addSectionToLayout, updateSectionInLayout, removeSectionFromLayout, sectionsOf,
  generateTabId, addTabToLayout, updateTabInLayout, removeTabFromLayout, tabsOf, tabsEnabled,
  moveFieldInLayout, moveFieldToTab, rowsOrderOf, setFieldHidden,
  buildVisibilityConditions, setFieldDisplayLogic, setTabDisplayLogic, setSectionDisplayLogic,
} from '../../src/tools/layout.js';

const layout = () => ({
  mode: 'fifty_fifty',
  fifty_fifty: { rows: [['title', ''], ['assigned_to', 'status']], sections: [] as any[] },
  seventy_thirty: { seventy: ['title'], thirty: ['status'], seventy_sections: [], thirty_sections: [] },
  single_column: { rows: ['title', 'assigned_to', 'status'], sections: [] as any[] },
  tabs: { enabled: true, tabs: [{ id: 'T1', name: 'Tab', position: 0, layout: { fifty_fifty: { rows: [['title', '']], sections: [] as any[] } } }] },
});

describe('generateSectionSlug', () => {
  it('produces section__s + 9 hex', () => {
    expect(generateSectionSlug()).toMatch(/^section__s[0-9a-f]{9}$/);
  });
});

describe('buildSectionDescription', () => {
  it('returns null for blank', () => {
    expect(buildSectionDescription('')).toBeNull();
    expect(buildSectionDescription(undefined)).toBeNull();
  });
  it('builds a ProseMirror doc + html, splitting paragraphs on blank lines', () => {
    const d = buildSectionDescription('Hello <there>\n\nSecond') as any;
    expect(d.data.content).toHaveLength(2);
    expect(d.data.content[0].content[0].text).toBe('Hello <there>');
    expect(d.html).toBe('<p>Hello &lt;there&gt;</p><p>Second</p>');
  });
});

describe('addSectionToLayout', () => {
  it('inserts a pair marker (fifty_fifty) + flat marker (single_column) after a field, and updates sections[]', () => {
    const { layout: out, bodiesUpdated } = addSectionToLayout(layout(), { title: 'S', slug: 'section__sx', description: null }, { afterField: 'status' });
    expect(bodiesUpdated).toBe(2); // fifty_fifty + single_column; seventy_thirty skipped
    expect(out.fifty_fifty.rows).toEqual([['title', ''], ['assigned_to', 'status'], ['section__sx', '']]);
    expect(out.single_column.rows).toEqual(['title', 'assigned_to', 'status', 'section__sx']);
    expect(out.fifty_fifty.sections.map((s: any) => s.slug)).toEqual(['section__sx']);
    expect(out.single_column.sections).toHaveLength(1);
    expect((out.seventy_thirty as any).seventy_sections).toEqual([]); // untouched
  });
  it('appends at the end when afterField is omitted', () => {
    const { layout: out } = addSectionToLayout(layout(), { title: 'S', slug: 'section__sy', description: null }, {});
    expect(out.fifty_fifty.rows[out.fifty_fifty.rows.length - 1]).toEqual(['section__sy', '']);
    expect(out.single_column.rows[out.single_column.rows.length - 1]).toBe('section__sy');
  });
  it('routes to a tab layout when tabId is given, leaving top-level untouched', () => {
    const { layout: out, bodiesUpdated } = addSectionToLayout(layout(), { title: 'S', slug: 'section__st', description: null }, { tabId: 'T1' });
    expect(bodiesUpdated).toBe(1);
    expect(out.tabs.tabs[0].layout.fifty_fifty.sections.map((s: any) => s.slug)).toEqual(['section__st']);
    expect(out.fifty_fifty.sections).toEqual([]); // top-level untouched
  });
  it('throws for an unknown tab', () => {
    expect(() => addSectionToLayout(layout(), { title: 'S', slug: 'section__sz', description: null }, { tabId: 'NOPE' })).toThrow(/not found/);
  });
  it('tabId "all" adds to the top-level layout AND every tab', () => {
    const { layout: out, bodiesUpdated } = addSectionToLayout(layout(), { title: 'S', slug: 'section__sall', description: null }, { tabId: 'all' });
    expect(bodiesUpdated).toBe(3); // top-level fifty_fifty + single_column, tab T1 fifty_fifty
    expect(out.fifty_fifty.sections.map((s: any) => s.slug)).toContain('section__sall');
    expect(out.single_column.sections.map((s: any) => s.slug)).toContain('section__sall');
    expect(out.tabs.tabs[0].layout.fifty_fifty.sections.map((s: any) => s.slug)).toContain('section__sall');
  });
  it('tabId "top" edits only the top-level layout, not tabs', () => {
    const { layout: out } = addSectionToLayout(layout(), { title: 'S', slug: 'section__stop', description: null }, { tabId: 'top' });
    expect(out.fifty_fifty.sections.map((s: any) => s.slug)).toContain('section__stop');
    expect(out.tabs.tabs[0].layout.fifty_fifty.sections.map((s: any) => s.slug)).not.toContain('section__stop');
  });
});

describe('moveFieldInLayout', () => {
  it('moves a field after another (flat) and re-inserts as a full-width row (pairs)', () => {
    const { layout: out, found } = moveFieldInLayout(layout(), 'status', { afterField: 'title' });
    expect(found).toBe(true);
    expect(out.single_column.rows).toEqual(['title', 'status', 'assigned_to']);
    expect(out.fifty_fifty.rows).toEqual([['title', ''], ['status', ''], ['assigned_to', '']]);
  });
  it('places a field under a section when afterField is a section slug', () => {
    const base = addSectionToLayout(layout(), { title: 'Sec', slug: 'section__sx', description: null }, {}).layout; // appended at end
    const { layout: out } = moveFieldInLayout(base, 'title', { afterField: 'section__sx' });
    const order = rowsOrderOf(out);
    expect(order.indexOf('section__sx')).toBeLessThan(order.indexOf('title'));
    expect(order.indexOf('title')).toBe(order.indexOf('section__sx') + 1);
  });
  it('returns found=false for a field not in the layout', () => {
    expect(moveFieldInLayout(layout(), 'nope', {}).found).toBe(false);
  });
});

describe('setFieldHidden', () => {
  it('adds the slug to hidden_fields when hiding (idempotent)', () => {
    const a = setFieldHidden({ hidden_fields: [] } as any, 'priority', true);
    expect(a.changed).toBe(true);
    expect(a.hiddenFields).toEqual(['priority']);
    const b = setFieldHidden(a.layout, 'priority', true);
    expect(b.changed).toBe(false); // already hidden
  });
  it('removes the slug when showing; initializes from null hidden_fields', () => {
    const hidden = setFieldHidden({} as any, 'priority', true).layout;
    const shown = setFieldHidden(hidden, 'priority', false);
    expect(shown.changed).toBe(true);
    expect(shown.hiddenFields).toEqual([]);
  });
});

describe('display logic', () => {
  const vc = buildVisibilityConditions('and', [{ comparison: 'is', field: 'status', value: 'complete' }], 'Priority');

  it('builds the uniform visibility_conditions shape', () => {
    expect(vc).toEqual({ operator: 'and', conditions: [{ comparison: 'is', field: 'status', value: 'complete' }], name: 'Priority' });
  });
  it('field: upserts into fields_visibility_conditions and clears with null', () => {
    const set = setFieldDisplayLogic({} as any, 'priority', vc);
    expect(set.changed).toBe(true);
    expect(set.layout.fields_visibility_conditions).toEqual([{ field_slug: 'priority', visibility_conditions: vc }]);
    const cleared = setFieldDisplayLogic(set.layout, 'priority', null);
    expect(cleared.layout.fields_visibility_conditions).toEqual([]);
  });
  it('tab: sets/removes tab.visibility_conditions', () => {
    const set = setTabDisplayLogic(layout(), 'T1', vc);
    expect(set.found).toBe(true);
    expect(set.layout.tabs.tabs[0].visibility_conditions).toEqual(vc);
    expect(setTabDisplayLogic(set.layout, 'T1', null).layout.tabs.tabs[0].visibility_conditions).toBeUndefined();
    expect(() => setTabDisplayLogic(layout(), 'NOPE', vc)).toThrow(/not found/);
  });
  it('section: sets visibility_conditions on the matching section across containers', () => {
    const base = addSectionToLayout(layout(), { title: 'Sec', slug: 'section__sx', description: null }, { tabId: 'all' }).layout;
    const set = setSectionDisplayLogic(base, 'section__sx', vc);
    expect(set.found).toBe(true);
    expect(set.layout.fifty_fifty.sections.find((s: any) => s.slug === 'section__sx').visibility_conditions).toEqual(vc);
    expect(set.layout.tabs.tabs[0].layout.fifty_fifty.sections.find((s: any) => s.slug === 'section__sx').visibility_conditions).toEqual(vc);
  });
});

describe('moveFieldToTab (cross-tab)', () => {
  const tabbed = () => ({
    mode: 'fifty_fifty',
    fifty_fifty: { rows: [['title', ''], ['a', 'b']], sections: [] as any[] },
    tabs: { enabled: true, tabs: [
      { id: 'A', name: 'A', position: 0, layout: { fifty_fifty: { rows: [['a', '']], sections: [] }, seventy_thirty: { seventy: [], thirty: ['a'], seventy_sections: [], thirty_sections: [] } } },
      { id: 'B', name: 'B', position: 1, layout: { fifty_fifty: { rows: [['b', '']], sections: [] }, seventy_thirty: { seventy: [], thirty: ['b'], seventy_sections: [], thirty_sections: [] } } },
      { id: 'C', name: 'C', position: 2, layout: null },
    ] },
  });

  it('removes the field from its current tab and adds it to the destination tab', () => {
    const { layout: out, toTabName } = moveFieldToTab(tabbed() as any, 'a', 'B');
    expect(toTabName).toBe('B');
    const A = out.tabs.tabs.find((t: any) => t.id === 'A');
    const B = out.tabs.tabs.find((t: any) => t.id === 'B');
    expect(A.layout.fifty_fifty.rows.flat()).not.toContain('a');
    expect(A.layout.seventy_thirty.thirty).not.toContain('a');
    expect(B.layout.fifty_fifty.rows.flat()).toContain('a');
    expect(B.layout.seventy_thirty.thirty).toContain('a');
  });
  it('initializes a layout when moving to an empty tab', () => {
    const { layout: out } = moveFieldToTab(tabbed() as any, 'a', 'C');
    const C = out.tabs.tabs.find((t: any) => t.id === 'C');
    expect(C.layout.fifty_fifty.rows).toEqual([['a', '']]);
  });
  it('throws for an unknown destination tab', () => {
    expect(() => moveFieldToTab(tabbed() as any, 'a', 'NOPE')).toThrow(/not found/);
  });
});

describe('tabsEnabled', () => {
  it('is true when tabs are enabled with at least one tab, false otherwise', () => {
    expect(tabsEnabled(layout())).toBe(true);
    expect(tabsEnabled(noTabs() as any)).toBe(false);
    expect(tabsEnabled({ tabs: { enabled: true, tabs: [] } } as any)).toBe(false);
  });
});

describe('updateSectionInLayout', () => {
  it('updates matching sections across bodies and reports found', () => {
    const base = addSectionToLayout(layout(), { title: 'Old', slug: 'section__sx', description: null }, {}).layout;
    const { layout: out, found } = updateSectionInLayout(base, 'section__sx', { title: 'New', collapsed: true }, undefined);
    expect(found).toBe(true);
    expect(out.fifty_fifty.sections[0].title).toBe('New');
    expect(out.fifty_fifty.sections[0].collapsed).toBe(true);
    expect(out.single_column.sections[0].title).toBe('New');
  });
  it('returns found=false for an unknown slug', () => {
    expect(updateSectionInLayout(layout(), 'section__nope', { title: 'x' }).found).toBe(false);
  });
});

describe('removeSectionFromLayout', () => {
  it('removes the section + its marker rows but preserves fields', () => {
    const base = addSectionToLayout(layout(), { title: 'S', slug: 'section__sx', description: null }, { afterField: 'status' }).layout;
    const { layout: out, found } = removeSectionFromLayout(base, 'section__sx', undefined);
    expect(found).toBe(true);
    expect(out.fifty_fifty.sections).toEqual([]);
    expect(out.fifty_fifty.rows).toEqual([['title', ''], ['assigned_to', 'status']]); // fields kept, marker gone
    expect(out.single_column.rows).toEqual(['title', 'assigned_to', 'status']);
  });
});

describe('sectionsOf', () => {
  it('summarizes sections in the target container', () => {
    const base = addSectionToLayout(layout(), { title: 'S', slug: 'section__sx', description: null, collapsed: true }, {}).layout;
    expect(sectionsOf(base)).toEqual([{ slug: 'section__sx', title: 'S', collapsed: true, hidden: false }]);
  });
});

const noTabs = () => ({
  mode: 'fifty_fifty',
  fifty_fifty: { rows: [['title', '']], sections: [] as any[] },
  single_column: { rows: ['title'], sections: [] as any[] },
});

describe('generateTabId', () => {
  it('produces a 6-char alphanumeric id', () => {
    expect(generateTabId()).toMatch(/^[A-Za-z0-9]{6}$/);
  });
});

describe('addTabToLayout', () => {
  it('appends an empty tab when tabs are already enabled', () => {
    const { layout: out, id } = addTabToLayout(layout(), { name: 'New' });
    expect(out.tabs.enabled).toBe(true);
    expect(out.tabs.tabs).toHaveLength(2);
    const added = out.tabs.tabs.find((t: any) => t.id === id);
    expect(added.layout).toBeUndefined(); // later tabs start empty
    expect(out.tabs.tabs.map((t: any) => t.position)).toEqual([0, 1]); // reindexed
  });
  it('enables tabs and mirrors the top-level layout into the first tab', () => {
    const { layout: out, id } = addTabToLayout(noTabs() as any, { name: 'First', style: 'journey' });
    expect(out.tabs.enabled).toBe(true);
    expect(out.tabs.style).toBe('journey');
    const tab = out.tabs.tabs.find((t: any) => t.id === id);
    expect(tab.layout.fifty_fifty.rows).toEqual([['title', '']]); // mirrored
  });
  it('inserts at a requested position', () => {
    const base = addTabToLayout(layout(), { name: 'B' }).layout; // [Tab, B]
    const { layout: out, id } = addTabToLayout(base, { name: 'Mid', position: 1 });
    const names = out.tabs.tabs.slice().sort((a: any, b: any) => a.position - b.position).map((t: any) => t.name);
    expect(names).toEqual(['Tab', 'Mid', 'B']);
    expect(out.tabs.tabs.find((t: any) => t.id === id).position).toBe(1);
  });
});

describe('updateTabInLayout', () => {
  it('renames, sets description, and reorders; reports found', () => {
    const { layout: out, found } = updateTabInLayout(layout(), 'T1', { name: 'Renamed', setDescription: true, description: { x: 1 } });
    expect(found).toBe(true);
    const t = out.tabs.tabs.find((x: any) => x.id === 'T1');
    expect(t.name).toBe('Renamed');
    expect(t.description).toEqual({ x: 1 });
  });
  it('sets container style/align and returns found=false for unknown tab', () => {
    const { layout: out, found } = updateTabInLayout(layout(), 'NOPE', { style: 'process' });
    expect(found).toBe(false);
    expect(out.tabs.style).toBe('process');
  });
});

describe('removeTabFromLayout', () => {
  it('removes a tab and reindexes', () => {
    const base = addTabToLayout(layout(), { name: 'B' }).layout;
    const { layout: out, found, disabled } = removeTabFromLayout(base, 'T1');
    expect(found).toBe(true);
    expect(disabled).toBe(false);
    expect(out.tabs.tabs.map((t: any) => t.name)).toEqual(['B']);
    expect(out.tabs.tabs[0].position).toBe(0);
  });
  it('disables tabs when the last one is removed', () => {
    const { layout: out, disabled } = removeTabFromLayout(layout(), 'T1');
    expect(disabled).toBe(true);
    expect(out.tabs.enabled).toBe(false);
    expect(out.tabs.tabs).toEqual([]);
  });
  it('returns found=false for an unknown tab', () => {
    expect(removeTabFromLayout(layout(), 'NOPE').found).toBe(false);
  });
});

describe('tabsOf', () => {
  it('summarizes the tab bar', () => {
    const s = tabsOf(layout()) as any;
    expect(s.enabled).toBe(true);
    expect(s.tabs).toEqual([{ id: 'T1', name: 'Tab', position: 0, hasLayout: true, hasDescription: false }]);
  });
});
