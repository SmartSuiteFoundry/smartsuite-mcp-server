import { describe, it, expect } from 'vitest';
import { applyViewConfig, defaultViewState, viewBindingWarning } from '../../src/tools/views.write.js';

describe('calendar date binding', () => {
  it('writes the date field where a calendar actually reads it', () => {
    const st = applyViewConfig(defaultViewState(), { dateField: 'due_date' });
    expect(st.calendarFieldsWindow.fields).toEqual([{ slug: 'due_date', color: { background: '#B7E3FB', font: '#2E3538' } }]);
  });

  it('warns when a calendar has no date field — it would open blank', () => {
    expect(viewBindingWarning('calendar', defaultViewState())).toContain('open empty');
    expect(viewBindingWarning('calendar', applyViewConfig(defaultViewState(), { dateField: 'd' }))).toBeNull();
  });
});

describe('kanban stack-by binding', () => {
  it('writes stackBy to columnFieldSlug, which is where a board reads its columns', () => {
    const st = applyViewConfig(defaultViewState(), { stackBy: 'status', swimlaneBy: 'owner' });
    expect(st.stackByWindow.columnFieldSlug).toBe('status');
    expect(st.stackByWindow.swimlaneFieldSlug).toBe('owner');
  });

  // The bug this fixes: groupBy looks like it should stack a board, and silently does not.
  it('groupBy alone leaves a board with no columns, and says so', () => {
    const st = applyViewConfig(defaultViewState(), { groupBy: [{ field: 'severity' }] });
    expect(st.stackByWindow.columnFieldSlug).toBeNull();
    expect(st.groupbyWindow.group).toEqual([{ field: 'severity' }]);
    expect(viewBindingWarning('kanban', st)).toContain('no stack-by field');
  });

  it('stays quiet for modes that need no binding', () => {
    expect(viewBindingWarning('grid', defaultViewState())).toBeNull();
  });
});

describe('applyViewConfig merges rather than replaces', () => {
  it('keeps an existing filter when only the binding changes', () => {
    const st = applyViewConfig(defaultViewState(), { filters: [{ field: 'x', comparison: 'is', value: 1 }] });
    const after = applyViewConfig(st, { stackBy: 'status' });
    expect(after.filterWindow.new_filters.conditions).toHaveLength(1);
    expect(after.stackByWindow.columnFieldSlug).toBe('status');
  });
});
