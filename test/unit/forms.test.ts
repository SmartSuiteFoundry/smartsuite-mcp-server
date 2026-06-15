import { describe, it, expect } from 'vitest';
import { parseItems, countFields, fieldsToItems, collectFormFields } from '../../src/tools/forms.js';

describe('parseItems', () => {
  it('parses a bound field with overrides', () => {
    const [f] = parseItems([
      { type: 'field', slug: 'title', required: true, params: { label: 'Subject', helpText: { enabled: true, value: 'Enter a subject' }, help_text_as_tooltip: true } },
    ]);
    expect(f).toMatchObject({ kind: 'field', slug: 'title', required: true, label: 'Subject', helpText: 'Enter a subject', depth: 0 });
  });

  it('surfaces linked-record table display', () => {
    const [f] = parseItems([
      { type: 'field', slug: 'sf1ac24c84', required: false, params: { linked_app_id: 'app1', display_type: 'table', table_visible_fields: ['title', 'status'] } },
    ]);
    expect(f).toMatchObject({ linkedAppId: 'app1', displayType: 'table', tableVisibleFields: ['title', 'status'] });
  });

  it('flattens sections and increments depth for nested fields', () => {
    const parsed = parseItems([
      { type: 'section', slug: 's1', params: { label: 'General', caption: null, conditions: null, items: [
        { type: 'field', slug: 'a', params: {} },
      ] } },
    ]);
    expect(parsed.map((i) => [i.kind, i.depth])).toEqual([['section', 0], ['field', 1]]);
    expect(parsed[0]).toMatchObject({ kind: 'section', label: 'General', hasConditions: false });
  });

  it('extracts text from heading (object doc) and callout (stringified doc)', () => {
    const parsed = parseItems([
      { type: 'heading', slug: 'h1', params: { label: 'H', doc: { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'This is a header' }] }] } } },
      { type: 'callout', slug: 'c1', params: { calloutType: 'info', doc: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Heads up"}]}]}' } },
    ]);
    expect(parsed[0]).toMatchObject({ kind: 'heading', text: 'This is a header' });
    expect(parsed[1]).toMatchObject({ kind: 'callout', calloutType: 'info', text: 'Heads up' });
  });

  it('surfaces media and layout element params', () => {
    const parsed = parseItems([
      { type: 'divider', slug: 'd', params: { title: 'Section break', color: { format: 'hex', color: '#DEDEDE' } } },
      { type: 'image', slug: 'i', params: { imageUrl: 'http://x/y.jpg', alignment: 'center' } },
      { type: 'video', slug: 'v', params: { videoUrl: 'http://yt/abc' } },
      { type: 'recaptcha', slug: 'r', params: {} },
      { type: 'pdf_viewer', slug: 'p', params: { type: 'upload', url: '' } },
    ]);
    expect(parsed[0]).toMatchObject({ kind: 'divider', title: 'Section break' });
    expect(parsed[1]).toMatchObject({ kind: 'image', imageUrl: 'http://x/y.jpg', alignment: 'center' });
    expect(parsed[2]).toMatchObject({ kind: 'video', videoUrl: 'http://yt/abc' });
    expect(parsed[3]).toMatchObject({ kind: 'recaptcha' });
    expect(parsed[4]).toMatchObject({ kind: 'pdf_viewer', source: 'upload' });
  });
});

describe('countFields', () => {
  it('counts fields across pages and nested sections, ignoring content elements', () => {
    const formState = {
      pages: [
        { page_type: 'form', items: [
          { type: 'field', slug: 'a' },
          { type: 'heading', slug: 'h' },
          { type: 'section', params: { items: [{ type: 'field', slug: 'b' }, { type: 'field', slug: 'c' }] } },
        ] },
        { page_type: 'form', items: [{ type: 'field', slug: 'd' }] },
        { page_type: 'submission', items: [] },
      ],
    };
    expect(countFields(formState)).toBe(4);
  });

  it('falls back to the legacy flat items array', () => {
    expect(countFields({ items: [{ type: 'field', slug: 'a' }, { type: 'heading' }] })).toBe(1);
  });

  it('returns 0 for null form_state', () => {
    expect(countFields(null)).toBe(0);
  });
});

describe('collectFormFields', () => {
  it('collects bound fields across input pages and sections, skipping content + non-form pages', () => {
    const fs = {
      pages: [
        { page_type: 'form', items: [
          { type: 'field', slug: 'title', required: true, params: { label: 'Title' } },
          { type: 'heading', slug: 'h', params: {} },
          { type: 'section', params: { items: [{ type: 'field', slug: 'status', required: false, params: { label: 'Status' } }] } },
        ] },
        { page_type: 'form', items: [{ type: 'field', slug: 'due_date', required: false, params: {} }] },
        { page_type: 'review', items: [], review: { field_slugs: ['title'] } },
        { page_type: 'submission', items: [] },
      ],
    };
    expect(collectFormFields(fs)).toEqual([
      { slug: 'title', required: true, label: 'Title' },
      { slug: 'status', required: false, label: 'Status' },
      { slug: 'due_date', required: false, label: null },
    ]);
  });

  it('falls back to flat items and returns [] for null', () => {
    expect(collectFormFields({ items: [{ type: 'field', slug: 'a', params: {} }] }).map((f) => f.slug)).toEqual(['a']);
    expect(collectFormFields(null)).toEqual([]);
  });
});

describe('fieldsToItems', () => {
  it('accepts slug strings and option objects', () => {
    const items = fieldsToItems(['title', { slug: 'status', required: true, label: 'State', helpText: 'pick one' }]);
    expect(items[0]).toMatchObject({ type: 'field', slug: 'title', required: false });
    expect(items[1]).toMatchObject({ type: 'field', slug: 'status', required: true, params: { label: 'State', helpText: { enabled: true, value: 'pick one' } } });
  });

  it('returns an empty array for non-array input', () => {
    expect(fieldsToItems(undefined)).toEqual([]);
  });
});
