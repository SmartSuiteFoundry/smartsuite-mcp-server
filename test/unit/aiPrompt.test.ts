import { describe, it, expect } from 'vitest';
import { buildAiPromptDoc, FIELD_TYPE_PILL_ICON } from '../../src/utils/aiPrompt.js';

const fields = [
  { slug: 'title', label: 'Name', field_type: 'recordtitlefield' },
  { slug: 's096c9e74e', label: 'Domain', field_type: 'linkfield' },
];

describe('buildAiPromptDoc', () => {
  it('turns {{slug}} into a pill with the field label + type icon, text around it as text nodes', () => {
    const { doc, referencedSlugs, unknownSlugs } = buildAiPromptDoc('Find LinkedIn for {{title}} at {{s096c9e74e}}.', fields);
    const para = doc.content[0] as any;
    expect(para.type).toBe('paragraph');
    expect(para.content).toEqual([
      { type: 'text', text: 'Find LinkedIn for ' },
      { type: 'pill', attrs: { icon: 'record-title', title: 'Name', value: 'title', invalid: false, tooltip: null } },
      { type: 'text', text: ' at ' },
      { type: 'pill', attrs: { icon: 'link', title: 'Domain', value: 's096c9e74e', invalid: false, tooltip: null } },
      { type: 'text', text: '.' },
    ]);
    expect(referencedSlugs).toEqual(['title', 's096c9e74e']);
    expect(unknownSlugs).toEqual([]);
  });

  it('reports unknown slugs and leaves them as literal text', () => {
    const { unknownSlugs, doc } = buildAiPromptDoc('Use {{nope}} here', fields);
    expect(unknownSlugs).toEqual(['nope']);
    expect((doc.content[0] as any).content).toEqual([{ type: 'text', text: 'Use {{nope}} here' }]);
  });

  it('splits newlines into separate paragraphs', () => {
    const { doc } = buildAiPromptDoc('Line one\nLine two', fields);
    expect(doc.content).toHaveLength(2);
    expect((doc.content[1] as any).content[0].text).toBe('Line two');
  });

  it('produces a plain single-paragraph doc when there are no references', () => {
    const { doc, referencedSlugs } = buildAiPromptDoc('Just classify this record.', fields);
    expect(referencedSlugs).toEqual([]);
    expect((doc.content[0] as any).content).toEqual([{ type: 'text', text: 'Just classify this record.' }]);
  });

  it('falls back to a default icon for unmapped field types', () => {
    const { doc } = buildAiPromptDoc('{{x}}', [{ slug: 'x', label: 'X', field_type: 'somenewfield' }]);
    expect((doc.content[0] as any).content[0].attrs.icon).toBe('record-title');
  });

  it('maps the common field types to their observed pill icons', () => {
    expect(FIELD_TYPE_PILL_ICON.linkedrecordfield).toBe('linked-records-2');
    expect(FIELD_TYPE_PILL_ICON.datefield).toBe('date-select');
  });
});
