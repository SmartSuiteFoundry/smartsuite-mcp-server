import { describe, it, expect } from 'vitest';
import { defaultViewState, applyViewConfig, KNOWN_VIEW_MODES } from '../../src/tools/views.write.js';

describe('defaultViewState', () => {
  it('returns a complete, fresh state each call (all windows, no shared refs)', () => {
    const a = defaultViewState();
    const b = defaultViewState();
    expect(a).not.toBe(b);
    expect(a.fieldsWindow).not.toBe(b.fieldsWindow);
    for (const w of ['filterWindow', 'fieldsWindow', 'sortWindow', 'groupbyWindow', 'calendarFieldsWindow', 'ganttFieldsWindow']) {
      expect(a).toHaveProperty(w);
    }
  });
});

describe('applyViewConfig', () => {
  it('overlays visibleFields, sort, groupBy, and filters (with operator)', () => {
    const s = applyViewConfig(defaultViewState(), {
      visibleFields: ['title', 'status'],
      sort: [{ field: 'title', direction: 'asc' }],
      groupBy: [{ field: 'status' }],
      filters: [{ field: 'status', comparison: 'is', value: 'x' }],
      filterOperator: 'or',
    });
    expect(s.fieldsWindow.visibleFields).toEqual(['title', 'status']);
    expect(s.fieldsWindow.fixedFieldsCount).toBe(1);
    expect(s.sortWindow.sort).toEqual([{ field: 'title', direction: 'asc' }]);
    expect(s.groupbyWindow.group).toEqual([{ field: 'status' }]);
    expect(s.filterWindow.new_filters).toEqual({ operator: 'or', conditions: [{ field: 'status', comparison: 'is', value: 'x' }] });
  });

  it('leaves windows untouched when the corresponding config is absent', () => {
    const before = defaultViewState();
    const s = applyViewConfig(defaultViewState(), { visibleFields: ['title'] });
    expect(s.sortWindow).toEqual(before.sortWindow);
    expect(s.groupbyWindow).toEqual(before.groupbyWindow);
  });

  it('defaults the filter operator to "and"', () => {
    const s = applyViewConfig(defaultViewState(), { filters: [] });
    expect(s.filterWindow.new_filters.operator).toBe('and');
  });
});

describe('KNOWN_VIEW_MODES', () => {
  it('covers the standard view types', () => {
    expect(KNOWN_VIEW_MODES).toEqual(expect.arrayContaining(['grid', 'card', 'kanban', 'calendar', 'timeline', 'gantt', 'chart', 'map']));
  });
});
