import { describe, it, expect } from 'vitest';
import { generateTabId, buildTabs, buildDashboardConfig, widgetLayoutPatch, KNOWN_WIDGET_TYPES, CONTENT_WIDGET_TYPES, DATA_WIDGET_TYPES, fillWidgetTemplate, pickTemplateFields } from '../../src/tools/dashboards.write.js';
import { WIDGET_TEMPLATES } from '../../src/tools/widget-templates.js';

describe('widget templates', () => {
  it('has a verified minimal template for every one of the 19 types', () => {
    expect(Object.keys(WIDGET_TEMPLATES).sort()).toEqual([...KNOWN_WIDGET_TYPES].sort());
  });
  it('substitutes app/solution/field tokens for data widgets', () => {
    const p = fillWidgetTemplate('list-view-widget', { solution: 'SOL', application: 'APP', primaryField: 'pf', selectField: 'sf', dateField: 'df' })!;
    expect(p.solution).toBe('SOL');
    expect(p.application).toBe('APP');
    expect((p.fields_window as any).visible_fields).toEqual(['pf']);
    // no leftover tokens anywhere
    expect(JSON.stringify(p)).not.toMatch(/__[A-Z_]+__/);
  });
  it('substitutes the select field into kanban stack-by', () => {
    const p = fillWidgetTemplate('kanban-view-widget', { solution: 'SOL', application: 'APP', primaryField: 'pf', selectField: 'sel', dateField: 'df' })!;
    expect(JSON.stringify(p)).toContain('sel');
    expect(JSON.stringify(p)).not.toMatch(/__[A-Z_]+__/);
  });
  it('falls back to the primary field when no select/date field exists', () => {
    const p = fillWidgetTemplate('kanban-view-widget', { solution: 'S', application: 'A', primaryField: 'pf', selectField: '', dateField: '' })!;
    expect(JSON.stringify(p)).not.toMatch(/__[A-Z_]+__/);
  });
  it('content widgets carry no app tokens', () => {
    const p = fillWidgetTemplate('divider-widget', { solution: 'S', application: 'A', primaryField: 'p', selectField: 's', dateField: 'd' })!;
    expect(p).toEqual({ color: '#3A86FF' });
  });
  it('returns null for an unknown widget type', () => {
    expect(fillWidgetTemplate('nope-widget', { solution: 'S', application: 'A', primaryField: 'p', selectField: 's', dateField: 'd' })).toBeNull();
  });
});

describe('pickTemplateFields', () => {
  const F = (slug: string, field_type: string, primary = false) => ({ slug, field_type, params: primary ? { primary: true } : {} }) as any;
  it('picks primary, first select, first date fields', () => {
    const out = pickTemplateFields([F('t', 'textfield', true), F('st', 'statusfield'), F('dd', 'duedatefield')]);
    expect(out).toEqual({ primaryField: 't', selectField: 'st', dateField: 'dd' });
  });
  it('falls back to the primary field when select/date are missing', () => {
    const out = pickTemplateFields([F('t', 'textfield', true)]);
    expect(out).toEqual({ primaryField: 't', selectField: 't', dateField: 't' });
  });
});

describe('widget type catalog', () => {
  it('has 6 content + 13 data = 19 verified types', () => {
    expect(CONTENT_WIDGET_TYPES).toHaveLength(6);
    expect(DATA_WIDGET_TYPES).toHaveLength(13);
    expect(KNOWN_WIDGET_TYPES.size).toBe(19);
  });
  it('recognizes real types and rejects non-types', () => {
    expect(KNOWN_WIDGET_TYPES.has('list-view-widget')).toBe(true);
    expect(KNOWN_WIDGET_TYPES.has('data-schema-widget')).toBe(true);
    expect(KNOWN_WIDGET_TYPES.has('grid-view-widget')).toBe(false);
    expect(KNOWN_WIDGET_TYPES.has('image-widget')).toBe(false);
  });
});

describe('generateTabId', () => {
  it('produces a 6-char alphanumeric id', () => {
    for (let i = 0; i < 20; i++) expect(generateTabId()).toMatch(/^[A-Za-z0-9]{6}$/);
  });
});

describe('buildTabs', () => {
  it('accepts name strings and assigns ids + order', () => {
    const tabs = buildTabs(['Overview', 'Details']);
    expect(tabs.map((t) => t.name)).toEqual(['Overview', 'Details']);
    expect(tabs.map((t) => t.order)).toEqual([0, 1]);
    expect(tabs[0].id).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(tabs[0].id).not.toBe(tabs[1].id);
  });
  it('preserves an existing id (rename/reorder) and generates for new tabs', () => {
    const tabs = buildTabs([{ id: 'XcOEKp', name: 'Renamed' }, { name: 'New' }]);
    expect(tabs[0].id).toBe('XcOEKp');
    expect(tabs[0].name).toBe('Renamed');
    expect(tabs[1].id).toMatch(/^[A-Za-z0-9]{6}$/);
  });
});

describe('buildDashboardConfig', () => {
  const existing = { tabs: { enabled: false, position: 'left', tabs: [{ id: 'a', name: 'Tab', order: 0 }], logo: null }, footer: { enabled: false }, style: { width: 'auto' } };

  it('replaces the tab array while preserving other tab config (logo, position)', () => {
    const cfg = buildDashboardConfig(existing as any, { tabs: [{ id: 'b', name: 'X', order: 0 }] });
    expect((cfg.tabs as any).tabs).toEqual([{ id: 'b', name: 'X', order: 0 }]);
    expect((cfg.tabs as any).position).toBe('left');
    expect((cfg.tabs as any).logo).toBeNull();
  });
  it('auto-enables the tab bar when adding more than one tab', () => {
    const cfg = buildDashboardConfig(existing as any, { tabs: [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B', order: 1 }] });
    expect((cfg.tabs as any).enabled).toBe(true);
  });
  it('respects an explicit tabsEnabled override', () => {
    const cfg = buildDashboardConfig(existing as any, { tabsEnabled: true });
    expect((cfg.tabs as any).enabled).toBe(true);
  });
  it('merges footer/style rather than replacing them', () => {
    const cfg = buildDashboardConfig(existing as any, { style: { background_color: '#000' } });
    expect(cfg.style).toEqual({ width: 'auto', background_color: '#000' });
  });
});

describe('widgetLayoutPatch', () => {
  it('maps position/size to API fields, omitting unspecified ones', () => {
    expect(widgetLayoutPatch({ position: { x: 2, y: 200 }, size: { width: 3 } })).toEqual({ position_x: 2, position_y: 200, width: 3 });
  });
  it('returns empty when no layout given', () => {
    expect(widgetLayoutPatch({})).toEqual({});
  });
});
