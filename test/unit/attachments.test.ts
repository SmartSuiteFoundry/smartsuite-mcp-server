import { describe, it, expect } from 'vitest';
import { mergeAttachments } from '../../src/tools/attachments.js';

const f = (h: string) => ({ handle: h, metadata: { filename: h + '.png' } });

describe('mergeAttachments', () => {
  it('append keeps the target\'s existing files then adds source', () => {
    expect(mergeAttachments([f('a')], [f('b'), f('c')], 'append').map((x: any) => x.handle)).toEqual(['a', 'b', 'c']);
  });
  it('replace overwrites the target with source files', () => {
    expect(mergeAttachments([f('a')], [f('b')], 'replace').map((x: any) => x.handle)).toEqual(['b']);
  });
});
