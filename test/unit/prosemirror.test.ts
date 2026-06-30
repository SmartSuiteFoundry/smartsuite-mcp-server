import { describe, it, expect } from 'vitest';
import { markdownToProseMirror, proseMirrorToText } from '../../src/utils/prosemirror.js';

const PARA = { textAlign: 'left', size: 'medium' };

describe('markdownToProseMirror', () => {
  it('returns null for blank input', () => {
    expect(markdownToProseMirror('')).toBeNull();
    expect(markdownToProseMirror(undefined)).toBeNull();
    expect(markdownToProseMirror('   ')).toBeNull();
  });

  it('matches the SmartSuite shape for paragraph + bullet list + bold (the live example)', () => {
    const out = markdownToProseMirror('This is help text.\n\n- Item 1\n- Item 2\n- **BOLD!**')!;
    expect(out.data).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: PARA, content: [{ type: 'text', text: 'This is help text.' }] },
        {
          type: 'bullet_list',
          content: [
            { type: 'list_item', content: [{ type: 'paragraph', attrs: PARA, content: [{ type: 'text', text: 'Item 1' }] }] },
            { type: 'list_item', content: [{ type: 'paragraph', attrs: PARA, content: [{ type: 'text', text: 'Item 2' }] }] },
            { type: 'list_item', content: [{ type: 'paragraph', attrs: PARA, content: [{ type: 'text', marks: [{ type: 'strong' }], text: 'BOLD!' }] }] },
          ],
        },
      ],
    });
    expect(out.html).toBe('<p>This is help text.</p><ul><li><p>Item 1</p></li><li><p>Item 2</p></li><li><p><strong>BOLD!</strong></p></li></ul>');
  });

  it('supports ordered lists and inline italic, escaping html', () => {
    const out = markdownToProseMirror('1. first\n2. *second* & <last>')!;
    expect((out.data as any).content[0].type).toBe('ordered_list');
    expect(out.html).toBe('<ol><li><p>first</p></li><li><p><em>second</em> &amp; &lt;last&gt;</p></li></ol>');
  });

  it('round-trips back to text via proseMirrorToText', () => {
    const out = markdownToProseMirror('Hello\n\n- a\n- b')!;
    expect(proseMirrorToText({ data: out.data })).toContain('Hello');
    expect(proseMirrorToText({ data: out.data })).toContain('a');
  });
});
