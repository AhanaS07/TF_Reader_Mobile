// Owner: Accessibility (Hruthik).
//
// A deliberately small XML reader, scoped to the only two documents the
// accessibility parser reads: META-INF/container.xml and the OPF package
// document. It reads element names, attributes and text. That is all.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY (Day-3 open item V4).
//   • There is NO XML parser in this repo's direct dependencies. @xmldom/xmldom,
//     sax, xml2js and parse5 all appear in node_modules, but every one of them is
//     TRANSITIVE (epub.js, @expo/plist, jsdom-via-jest-expo). Importing a package
//     nobody declared means a `npm dedupe` or an Expo bump can delete it.
//   • This has to run under Hermes on device. There is no DOMParser there, so the
//     platform is not an option either.
//   • Adding a runtime dependency edits a package.json five capabilities share,
//     for a prototype. The grammar actually needed is small enough to not be worth
//     that.
//
// WHERE THE LINE IS. This is NOT a general XML parser and must not grow into one.
// It has no namespace resolution (element names are compared by LOCAL name), no
// DTD, no entity declarations, no xml:space. If the accessibility parser ever
// needs more of XML than this, that is the signal to revisit V4 with the Reader /
// build owner and take a real dependency — not to extend this file.
//
// It is still STRICT about well-formedness, because `malformed-xml` is a result
// the caller has to be able to produce (Day-3 D7). A scanner that quietly
// tolerated an unclosed tag would report partial metadata as if it were complete,
// which is the failure D7 exists to prevent.

/** One element. `name` is the LOCAL name — any namespace prefix is stripped. */
export interface XmlElement {
  name: string;
  /**
   * Attributes keyed by their name VERBATIM, prefix included (`xml:lang`,
   * `media-type`, `full-path`). A Map, not an object: attribute names come from
   * a file we do not control, and `__proto__` is a legal-looking key.
   */
  attributes: Map<string, string>;
  children: XmlElement[];
  /**
   * Direct text content, entities decoded. NOT whitespace-collapsed — collapsing
   * is the caller's decision, and it differs per property (tokens are trimmed,
   * prose is collapsed).
   */
  text: string;
}

export type XmlReadResult =
  | { ok: true; root: XmlElement }
  /** `reason` is a developer-facing string for logs. It is never shown to a user. */
  | { ok: false; reason: string };

/** The five entities XML predefines. Anything else needs a DTD we do not read. */
const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const WHITESPACE = /\s/;

function localName(qualifiedName: string): string {
  const colon = qualifiedName.indexOf(':');
  return colon === -1 ? qualifiedName : qualifiedName.slice(colon + 1);
}

/**
 * Decodes entity references. Returns null when one is not well-formed.
 *
 * Null is how a bare `&` is caught — the single most common malformation in
 * hand-edited OPF metadata. `&` followed by no `;`, or by something that is not
 * one of the five predefined names or a numeric reference, is a well-formedness
 * error in XML, and we report it as one rather than passing the raw text through.
 *
 * That does mean a DTD-declared entity (`&nbsp;` in an OPF, say) fails the whole
 * document. It is genuinely invalid XML without a matching declaration, epubcheck
 * flags it, and every conforming parser rejects it too — so failing here matches
 * what the rest of the toolchain would do, rather than inventing a laxer dialect.
 */
function decodeEntities(raw: string): string | null {
  if (!raw.includes('&')) return raw;

  let out = '';
  let cursor = 0;

  while (cursor < raw.length) {
    const amp = raw.indexOf('&', cursor);
    if (amp === -1) {
      out += raw.slice(cursor);
      break;
    }
    out += raw.slice(cursor, amp);

    const semicolon = raw.indexOf(';', amp + 1);
    if (semicolon === -1 || semicolon === amp + 1) return null;

    const reference = raw.slice(amp + 1, semicolon);

    if (reference.startsWith('#')) {
      const hex = reference[1] === 'x' || reference[1] === 'X';
      const digits = hex ? reference.slice(2) : reference.slice(1);
      const valid = hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/;
      if (!valid.test(digits)) return null;

      const codePoint = parseInt(digits, hex ? 16 : 10);
      if (codePoint < 0 || codePoint > 0x10ffff) return null;
      out += String.fromCodePoint(codePoint);
    } else {
      const replacement = PREDEFINED_ENTITIES[reference];
      if (replacement === undefined) return null;
      out += replacement;
    }

    cursor = semicolon + 1;
  }

  return out;
}

interface StartTag {
  name: string;
  attributes: Map<string, string>;
  selfClosing: boolean;
  /** Index just past the closing `>`. */
  end: number;
}

/** Reads a start tag beginning at `<`. Null means not well-formed. */
function readStartTag(source: string, start: number): StartTag | null {
  let cursor = start + 1;

  const nameStart = cursor;
  while (cursor < source.length && !/[\s/>]/.test(source[cursor])) cursor++;
  const qualifiedName = source.slice(nameStart, cursor);
  if (qualifiedName === '') return null;

  const attributes = new Map<string, string>();

  for (;;) {
    while (cursor < source.length && WHITESPACE.test(source[cursor])) cursor++;
    if (cursor >= source.length) return null;

    if (source[cursor] === '>') {
      return { name: localName(qualifiedName), attributes, selfClosing: false, end: cursor + 1 };
    }
    if (source[cursor] === '/') {
      if (source[cursor + 1] !== '>') return null;
      return { name: localName(qualifiedName), attributes, selfClosing: true, end: cursor + 2 };
    }

    const attributeStart = cursor;
    while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor++;
    const attributeName = source.slice(attributeStart, cursor);
    if (attributeName === '') return null;

    while (cursor < source.length && WHITESPACE.test(source[cursor])) cursor++;
    // XML has no valueless attributes. `<meta hidden>` is HTML, not XML.
    if (source[cursor] !== '=') return null;
    cursor++;

    while (cursor < source.length && WHITESPACE.test(source[cursor])) cursor++;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") return null;

    const valueEnd = source.indexOf(quote, cursor + 1);
    if (valueEnd === -1) return null;

    const rawValue = source.slice(cursor + 1, valueEnd);
    // An unescaped `<` in an attribute value means the quote we matched was not
    // the real one — usually a missing closing quote swallowing the rest of the
    // tag. Accepting it produces confident nonsense.
    if (rawValue.includes('<')) return null;

    const value = decodeEntities(rawValue);
    if (value === null) return null;

    // Duplicate attributes are a well-formedness error. Last-one-wins would hide
    // a file that declares `property` twice with different values.
    if (attributes.has(attributeName)) return null;
    attributes.set(attributeName, value);

    cursor = valueEnd + 1;
  }
}

/**
 * Skips `<!DOCTYPE …>` / `<!…>`, tracking `[` `]` so an internal subset
 * containing `>` does not end the declaration early. Returns -1 if unterminated.
 */
function skipDeclaration(source: string, start: number): number {
  let depth = 0;
  for (let cursor = start + 2; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (char === '[') depth++;
    else if (char === ']') depth--;
    else if (char === '>' && depth <= 0) return cursor + 1;
  }
  return -1;
}

/**
 * Reads an XML document into a tree, or reports that it is not well-formed.
 *
 * Never throws. Every failure path returns `{ ok: false }`, because the caller's
 * contract is that a bad file degrades rather than propagating.
 */
export function readXml(source: string): XmlReadResult {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let cursor = 0;

  const fail = (reason: string): XmlReadResult => ({ ok: false, reason });

  while (cursor < source.length) {
    const open = source.indexOf('<', cursor);

    if (open === -1) {
      const tail = source.slice(cursor);
      const parent = stack[stack.length - 1];
      if (parent) {
        const decoded = decodeEntities(tail);
        if (decoded === null) return fail('invalid entity reference in text');
        parent.text += decoded;
      } else if (tail.trim() !== '') {
        return fail('character data outside the root element');
      }
      break;
    }

    if (open > cursor) {
      const raw = source.slice(cursor, open);
      const parent = stack[stack.length - 1];
      if (parent) {
        const decoded = decodeEntities(raw);
        if (decoded === null) return fail('invalid entity reference in text');
        parent.text += decoded;
      } else if (raw.trim() !== '') {
        return fail('character data outside the root element');
      }
    }

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1) return fail('unterminated comment');
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end === -1) return fail('unterminated CDATA section');
      const parent = stack[stack.length - 1];
      // CDATA is literal by definition — no entity decoding.
      if (parent) parent.text += source.slice(open + 9, end);
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<!', open)) {
      const end = skipDeclaration(source, open);
      if (end === -1) return fail('unterminated declaration');
      cursor = end;
      continue;
    }

    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2);
      if (end === -1) return fail('unterminated processing instruction');
      cursor = end + 2;
      continue;
    }

    if (source.startsWith('</', open)) {
      const end = source.indexOf('>', open + 2);
      if (end === -1) return fail('unterminated end tag');
      const name = localName(source.slice(open + 2, end).trim());
      const opened = stack.pop();
      if (!opened || opened.name !== name) {
        return fail(`end tag </${name}> does not match the open element`);
      }
      cursor = end + 1;
      continue;
    }

    const tag = readStartTag(source, open);
    if (!tag) return fail('malformed start tag');

    const element: XmlElement = {
      name: tag.name,
      attributes: tag.attributes,
      children: [],
      text: '',
    };

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(element);
    } else if (root) {
      return fail('more than one root element');
    } else {
      root = element;
    }

    if (!tag.selfClosing) stack.push(element);
    cursor = tag.end;
  }

  if (stack.length > 0) return fail(`unclosed <${stack[stack.length - 1].name}>`);
  if (!root) return fail('no root element');
  return { ok: true, root };
}

/** Direct children with the given local name, in document order. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** First descendant (or self) with the given local name, depth-first. */
export function findElement(element: XmlElement, name: string): XmlElement | undefined {
  if (element.name === name) return element;
  for (const child of element.children) {
    const found = findElement(child, name);
    if (found) return found;
  }
  return undefined;
}
