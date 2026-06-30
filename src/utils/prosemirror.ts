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

const PARA_ATTRS = { textAlign: 'left', size: 'medium' };
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface InlineSeg { text: string; mark?: 'strong' | 'em'; }

/** Parse inline **bold** / *italic* / _italic_ into segments. */
function parseInline(text: string): InlineSeg[] {
  const out: InlineSeg[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] != null || m[3] != null) out.push({ text: (m[2] ?? m[3])!, mark: 'strong' });
    else out.push({ text: (m[4] ?? m[5])!, mark: 'em' });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((s) => s.text.length > 0);
}

function inlineToNodes(text: string): unknown[] {
  return parseInline(text).map((s) => (s.mark ? { type: 'text', marks: [{ type: s.mark }], text: s.text } : { type: 'text', text: s.text }));
}
function inlineToHtml(text: string): string {
  return parseInline(text).map((s) => (s.mark === 'strong' ? `<strong>${esc(s.text)}</strong>` : s.mark === 'em' ? `<em>${esc(s.text)}</em>` : esc(s.text))).join('');
}
const paragraph = (text: string): unknown => ({ type: 'paragraph', attrs: PARA_ATTRS, content: inlineToNodes(text) });
const listItem = (text: string): unknown => ({ type: 'list_item', content: [paragraph(text)] });

/**
 * Convert lightweight markdown to a SmartSuite ProseMirror doc `{ data, html }` (the shape stored in
 * `params.help_doc`, section/tab descriptions, etc.). Supports paragraphs (blank-line separated),
 * bullet lists (`-`/`*`), ordered lists (`1.`), and inline **bold** / *italic*. Returns null for blank.
 */
export function markdownToProseMirror(md?: string | null): { data: unknown; html: string } | null {
  if (!md || !md.trim()) return null;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: unknown[] = [];
  const html: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push({ type: list.ordered ? 'ordered_list' : 'bullet_list', content: items.map(listItem) });
    const tag = list.ordered ? 'ol' : 'ul';
    html.push(`<${tag}>${items.map((t) => `<li><p>${inlineToHtml(t)}</p></li>`).join('')}</${tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (bullet) {
      if (list && !list.ordered) list.items.push(bullet[1]);
      else { flushList(); list = { ordered: false, items: [bullet[1]] }; }
    } else if (ordered) {
      if (list && list.ordered) list.items.push(ordered[1]);
      else { flushList(); list = { ordered: true, items: [ordered[1]] }; }
    } else {
      flushList();
      blocks.push(paragraph(line));
      html.push(`<p>${inlineToHtml(line)}</p>`);
    }
  }
  flushList();
  if (blocks.length === 0) return null;
  return { data: { type: 'doc', content: blocks }, html: html.join('') };
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
