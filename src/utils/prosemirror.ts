/**
 * Flatten a SmartSuite ProseMirror/SmartDoc document to plain text.
 *
 * Help text (field `params.help_doc`), section/field rich text, and solution
 * descriptions are all stored as ProseMirror docs shaped like:
 *   { data: { type: "doc", content: [ { type: "paragraph", content: [ { type: "text", text: "..." } ] } ] } }
 * Some payloads also carry a sibling `html` / `preview` string.
 *
 * Returns an empty string when there is no extractable text.
 */
export function proseMirrorToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();

  const v = value as Record<string, unknown>;

  // Common wrapper: { data: <doc>, html, preview }
  if ('data' in v || 'html' in v || 'preview' in v) {
    if (v['data'] != null && typeof v['data'] === 'object') {
      const fromDoc = walkNode(v['data']).replace(/\n{3,}/g, '\n\n').trim();
      if (fromDoc) return fromDoc;
    }
    if (typeof v['preview'] === 'string' && v['preview'].trim()) return v['preview'].trim();
    if (typeof v['html'] === 'string' && v['html'].trim()) {
      return v['html'].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  // A raw ProseMirror node ({ type, content, text })
  return walkNode(value).replace(/\n{3,}/g, '\n\n').trim();
}

/** Recursively collect text from a ProseMirror node, inserting newlines at block boundaries. */
function walkNode(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(walkNode).join('');

  const n = node as Record<string, unknown>;
  let out = '';

  if (typeof n['text'] === 'string') out += n['text'];
  if (Array.isArray(n['content'])) out += (n['content'] as unknown[]).map(walkNode).join('');

  // Block-level nodes get a trailing newline so paragraphs/list items stay separated.
  const type = n['type'];
  if (type === 'paragraph' || type === 'heading' || type === 'listItem' || type === 'blockquote') {
    out += '\n';
  }
  return out;
}
