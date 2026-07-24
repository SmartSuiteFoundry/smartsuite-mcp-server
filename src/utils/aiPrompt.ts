// Build a SmartSuite AI-field "instructions" prompt as the ProseMirror doc the UI produces, where a
// dynamic reference to another field is a `pill` node. Hand-authoring these pills is the flaky part of
// creating AI fields via the API (a malformed pill is rejected); this turns a `{{slug}}` template into a
// correct doc deterministically. Mirrors the markdown→ProseMirror approach used for field help text.

/** field_type → pill `icon` (observed across real AI fields; cosmetic — `value`=slug is the actual reference). */
export const FIELD_TYPE_PILL_ICON: Record<string, string> = {
  recordtitlefield: 'record-title',
  singleselectfield: 'single-select',
  multipleselectfield: 'multiple-select',
  statusfield: 'single-select',
  linkfield: 'link',
  linkedrecordfield: 'linked-records-2',
  emailfield: 'email',
  phonefield: 'phone',
  datefield: 'date-select',
  duedatefield: 'date-range',
  filefield: 'attachment',
  addressfield: 'address-field',
  richtextareafield: 'smartdoc',
  textareafield: 'smartdoc',
  textfield: 'text',
  numberfield: 'number',
};
const FALLBACK_ICON = 'record-title';

interface FieldLike { slug: string; label: string; field_type: string }

export interface BuiltPrompt {
  doc: { type: 'doc'; content: Array<Record<string, unknown>> };
  referencedSlugs: string[];
  unknownSlugs: string[];
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Convert a template string into an AI-field instructions doc. `{{field_slug}}` becomes a pill referencing
 * that field (resolved to its label + type icon from `fields`); an unknown slug is left as literal text and
 * reported in `unknownSlugs`. Newlines split the text into paragraphs.
 */
export function buildAiPromptDoc(template: string, fields: FieldLike[]): BuiltPrompt {
  const bySlug = new Map(fields.map((f) => [f.slug, f]));
  const referenced: string[] = [];
  const unknown: string[] = [];

  const paragraphs = template.split('\n').map((line) => {
    const content: Array<Record<string, unknown>> = [];
    // Append text, merging into a trailing text node so we don't emit adjacent text nodes.
    const pushText = (text: string) => {
      if (!text) return;
      const last = content[content.length - 1] as { type?: string; text?: string } | undefined;
      if (last && last.type === 'text') last.text += text;
      else content.push({ type: 'text', text });
    };
    let cursor = 0;
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(line)) !== null) {
      pushText(line.slice(cursor, m.index));
      const slug = m[1];
      const f = bySlug.get(slug);
      if (!f) {
        unknown.push(slug);
        pushText(m[0]);
      } else {
        referenced.push(slug);
        content.push({ type: 'pill', attrs: { icon: FIELD_TYPE_PILL_ICON[f.field_type] ?? FALLBACK_ICON, title: f.label, value: slug, invalid: false, tooltip: null } });
      }
      cursor = m.index + m[0].length;
    }
    pushText(line.slice(cursor));
    return { type: 'paragraph', attrs: { textAlign: 'left', size: 'medium' }, content };
  });

  return {
    doc: { type: 'doc', content: paragraphs },
    referencedSlugs: [...new Set(referenced)],
    unknownSlugs: [...new Set(unknown)],
  };
}
