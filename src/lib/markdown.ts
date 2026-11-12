/**
 * What renderMarkdown needs besides the text.
 */
export interface MarkdownOptions {
    base?: string;
    offset?: number;
}

interface Reference {
    href: string;
    title: string | null;
}

interface Context {
    base: string;
    offset: number;
    references: Map<string, Reference>;
    ids: Map<string, number>;
    scan: number;
}

interface Destination extends Reference {
    end: number;
}

interface ListBlock {
    items: string[][];
    loose: boolean;
    ordered: boolean;
    first: number;
    end: number;
}

// Longest source that is rendered, the rest being cut off
const MAX_SOURCE = 262144;

// Longest line that is read, the rest of the line being cut off, which bounds the work of the patterns below
const MAX_LINE = 5000;

// Longest text of one block that is read for inline marks, beyond which it is written as plain text
const MAX_INLINE = 10000;

// Deepest nesting of quotes, lists and inline marks, beyond which the text is written as it is
const MAX_DEPTH = 8;

// Longest text of a link or an image that is looked for, which bounds the work of a run of opening brackets
const MAX_LABEL = 1000;

// Characters that the whole document may spend looking for closing brackets, after which no more link is read
const MAX_SCAN = 2000000;

// Named character references that are decoded, the others being written as they are
const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    copy: '\u00a9',
    reg: '\u00ae',
    trade: '\u2122',
    mdash: '\u2014',
    ndash: '\u2013',
    hellip: '\u2026',
    laquo: '\u00ab',
    raquo: '\u00bb',
    lsquo: '\u2018',
    rsquo: '\u2019',
    ldquo: '\u201c',
    rdquo: '\u201d',
    bull: '\u2022',
    middot: '\u00b7',
    deg: '\u00b0',
    plusmn: '\u00b1',
    times: '\u00d7',
    divide: '\u00f7',
    euro: '\u20ac',
    pound: '\u00a3',
    yen: '\u00a5',
    cent: '\u00a2',
    sect: '\u00a7',
    para: '\u00b6',
    larr: '\u2190',
    rarr: '\u2192',
    uarr: '\u2191',
    darr: '\u2193',
    harr: '\u2194',
    check: '\u2713',
};

// Schemes that a link may use, an image using the first two
const SCHEMES = ['http', 'https', 'mailto'];

const FENCE = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?=[ ]|$)(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ ]*\1){2,}[ ]*$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ ]+(.*))?$/;
const SETEXT = /^ {0,3}(=+|-+)[ ]*$/;
const SEPARATOR = /^ {0,3}\|?[ ]*:?-+:?[ ]*(?:\|[ ]*:?-+:?[ ]*)*\|?[ ]*$/;
const DEFINITION = /^ {0,3}\[([^\]]{1,200})\]:[ ]*(<[^>]*>|\S+)(?:[ ]+("[^"]*"|'[^']*'|\([^)]*\)))?[ ]*$/;
const BACKTICKS = /`+/y;
const EMPHASIS = /([*_~])\1*/y;
const REFERENCE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/y;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/iy;
const BARE = /https?:\/\/[^\s<>]+/iy;

/**
 * Writes text so that it can stand in HTML content or in a quoted attribute.
 *
 * @param text - Any text
 * @returns The text with & < > " and ' written as numeric entities
 */
function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (mark) => `&#${mark.charCodeAt(0)};`);
}

/**
 * Tells whether a text holds a space or a control character.
 *
 * @param text - Text to look at
 * @returns true when a character is U+0020 or below, or U+007F
 */
function hasSpaceOrControl(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code <= 32 || code === 127) return true;
    }

    return false;
}

/**
 * Matches a sticky pattern at a position.
 *
 * @param pattern - Pattern with the sticky flag
 * @param text - Text to look in
 * @param at - Position the match must start at
 * @returns The match, or null
 */
function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
    pattern.lastIndex = at;

    return pattern.exec(text);
}

/**
 * Reads an opening fence.
 *
 * @param line - Line to look at
 * @returns The marker, a run of backticks or tildes, and the first word of the info string; null when the line does
 * not open a fence, which holds for a backtick fence whose info string holds a backtick
 */
function fenceOf(line: string): { marker: string; language: string } | null {
    const match = FENCE.exec(line);
    if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null;

    return { marker: match[1], language: match[2].trim().split(/\s/, 1)[0] };
}

/**
 * Makes the id of a heading from its text, the way GitHub does: lower case, letters, digits, hyphens and underscores
 * kept, each space becoming a hyphen and anything else being dropped.
 *
 * @param html - Inline HTML of the heading, whose tags and character references are not part of the id
 * @param ids - Ids already given, which receives this one
 * @returns An id made unique by a numeric suffix
 */
function headingId(html: string, ids: Map<string, number>): string {
    const text = html.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
    const slug =
        [
            ...text
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
                .replace(/ /g, '-'),
        ]
            .slice(0, 60)
            .join('') || 'section';
    const seen = ids.get(slug) ?? 0;
    ids.set(slug, seen + 1);

    return seen === 0 ? slug : `${slug}-${seen}`;
}

/**
 * Decides where a link or an image goes, if anywhere.
 * Only http, https and mailto are followed, mailto not for an image. A relative address is resolved against the base
 * folder, a root-relative one too, and cannot leave the origin. Anything else, javascript: and data: included, is
 * refused, as is an address that holds a space, a control character or a backslash, which a browser reads as a slash.
 *
 * @param raw - Address as the author wrote it
 * @param context - Base folder of the relative addresses
 * @param image - true for the source of an image
 * @returns The address to write, not yet escaped, or null when it must not be followed
 */
function safeUrl(raw: string, context: Context, image: boolean): string | null {
    const href = raw.trim();
    if (href === '' || hasSpaceOrControl(href) || href.includes('\\')) return null;

    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
    if (scheme) {
        const allowed = image ? SCHEMES.slice(0, 2) : SCHEMES;

        return allowed.includes(scheme[1].toLowerCase()) ? href : null;
    }
    if (href.startsWith('#')) return image ? null : href;
    if (href.startsWith('//')) return null;

    try {
        const url = new URL(href.startsWith('/') ? href.slice(1) : href, `http://base.invalid${context.base}`);

        return `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`;
    } catch {
        return null;
    }
}

/**
 * Finds the bracket that closes the one before a position.
 *
 * @param text - Text to look in
 * @param from - Position just after the opening bracket
 * @param open - Opening bracket character
 * @param close - Closing bracket character
 * @param context - Counts the characters looked at, whose budget is the same for the whole document
 * @returns The position of the matching closing bracket, backslashes and nested pairs honoured, -1 if none within
 * MAX_LABEL characters or within what is left of the budget of the document
 */
function findClosing(text: string, from: number, open: string, close: string, context: Context): number {
    let depth = 1;
    for (let i = from; i < text.length && i < from + MAX_LABEL; i++) {
        if (++context.scan > MAX_SCAN) return -1;

        const char = text[i];
        if (char === '\\') i++;
        else if (char === open) depth++;
        else if (char === close && --depth === 0) return i;
    }

    return -1;
}

/**
 * Skips the spaces and line feeds from a position.
 *
 * @param text - Text to look in
 * @param from - Position to start at
 * @returns The position of the first character that is neither
 */
function skipSpace(text: string, from: number): number {
    let i = from;
    while (text[i] === ' ' || text[i] === '\n') i++;

    return i;
}

/**
 * Reads the destination of a link, `(address "title")`, starting at its opening parenthesis.
 *
 * @param text - Text holding the link
 * @param start - Position of the opening parenthesis
 * @returns The address, the title or null, and the position after the closing parenthesis; null when it is not a link
 * destination
 */
function parseDestination(text: string, start: number): Destination | null {
    let i = skipSpace(text, start + 1);
    let href: string;

    if (text[i] === '<') {
        const end = text.indexOf('>', i);
        if (end === -1) return null;
        href = text.slice(i + 1, end);
        i = end + 1;
    } else {
        const from = i;
        let depth = 0;
        for (; i < text.length; i++) {
            const char = text[i];
            if (char === '\\') i++;
            else if (char === '(') depth++;
            else if (char === ')' && depth-- === 0) break;
            else if (char === ' ' || char === '\n') break;
        }
        href = text.slice(from, i);
    }

    i = skipSpace(text, i);
    let title: string | null = null;
    const quote = text[i];
    if (quote === '"' || quote === "'" || quote === '(') {
        const end = text.indexOf(quote === '(' ? ')' : quote, i + 1);
        if (end === -1) return null;
        title = text.slice(i + 1, end);
        i = skipSpace(text, end + 1);
    }

    return text[i] === ')' ? { href, title, end: i + 1 } : null;
}

/**
 * Writes the HTML of a link or an image whose address is known.
 *
 * @param label - Inline HTML of the link text, or the alt text of an image
 * @param destination - Address and title
 * @param context - Base folder of the relative addresses
 * @param image - true for an image
 * @returns The element, or just the label when the address must not be followed
 */
function element(label: string, destination: Reference, context: Context, image: boolean): string {
    const href = safeUrl(destination.href, context, image);
    if (href === null) return label;

    const title = destination.title === null ? '' : ` title="${escapeHtml(destination.title)}"`;
    const url = escapeHtml(href);
    if (image) return `<img src="${url}" alt="${label}"${title} loading="lazy" referrerpolicy="no-referrer">`;

    const outside = /^https?:/i.test(href);

    return `<a href="${url}"${title}${outside ? ' rel="noopener noreferrer nofollow"' : ''}>${label}</a>`;
}

/**
 * Tells whether a run of marks sits where emphasis may open or close.
 *
 * @param text - Text holding the run
 * @param position - Position of the run
 * @param length - Length of the run
 * @param opening - true when the run would open emphasis, false when it would close it
 * @returns true when no space touches the run on the inside, and, for an underscore, no word character touches it on
 * the outside
 */
function flanks(text: string, position: number, length: number, opening: boolean): boolean {
    const before = position === 0 ? ' ' : text[position - 1];
    const after = position + length >= text.length ? ' ' : text[position + length];
    const inside = opening ? after : before;
    const outside = opening ? before : after;

    return !/\s/.test(inside) && !(text[position] === '_' && /\w/.test(outside));
}

/**
 * Finds the mark that closes a run of emphasis.
 * A run of the mark's character closes only when it is as long as the mark, or three long, the extra mark then staying
 * inside, so that a single mark does not close on half of a pair and *a **b*** nests as it reads.
 *
 * @param text - Text holding the run
 * @param from - Position after the opening mark
 * @param mark - The mark, such as ** or _
 * @returns The position of the closing mark, which must be able to close, or -1
 */
function closing(text: string, from: number, mark: string): number {
    const char = mark[0];
    let at = text.indexOf(char, from);
    while (at !== -1) {
        let end = at;
        while (text[end] === char) end++;

        const length = end - at;
        const position = length === mark.length ? at : length === 3 ? end - mark.length : -1;
        if (position > from && text[at - 1] !== '\\' && flanks(text, position, mark.length, false)) return position;

        at = text.indexOf(char, end);
    }

    return -1;
}

/**
 * Writes a character reference as the character it stands for.
 *
 * @param match - A match of REFERENCE
 * @returns The escaped character, or null when the reference is unknown, out of range or a control character
 */
function decodeReference(match: RegExpExecArray): string | null {
    if (match[3] !== undefined) {
        const named = Object.hasOwn(ENTITIES, match[3]) ? ENTITIES[match[3]] : undefined;

        return named === undefined ? null : escapeHtml(named);
    }

    const code = match[1] !== undefined ? Number(match[1]) : parseInt(match[2], 16);
    const control = code < 32 && code !== 9 && code !== 10;
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || control) return null;

    return escapeHtml(String.fromCodePoint(code));
}

/**
 * Renders the inline marks of a text.
 * Everything that is not a mark is escaped, and no raw HTML is read, so the output holds only the elements below.
 *
 * @param text - Text of one block, its lines joined by line feeds
 * @param context - Base folder and reference definitions
 * @param depth - How deep in other marks the text is
 * @returns The HTML of the text
 */
function renderInline(text: string, context: Context, depth: number): string {
    if (depth > MAX_DEPTH || text.length > MAX_INLINE) return escapeHtml(text);

    let out = '';
    let i = 0;
    const missing = new Map<string, number>();
    while (i < text.length) {
        const char = text[i];
        const ticks = char === '`' ? matchAt(BACKTICKS, text, i) : null;
        const marks = char === '*' || char === '_' || char === '~' ? matchAt(EMPHASIS, text, i) : null;
        const auto = char === '<' ? matchAt(AUTOLINK, text, i) : null;
        const reference = char === '&' ? matchAt(REFERENCE, text, i) : null;
        const decoded = reference && decodeReference(reference);
        const bare = char === 'h' && (i === 0 || /[\s(]/.test(text[i - 1])) ? matchAt(BARE, text, i) : null;

        if (char === '\\' && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1])) {
            out += escapeHtml(text[i + 1]);
            i += 2;
        } else if (char === '\\' && text[i + 1] === '\n') {
            out += '<br>';
            i += 2;
        } else if (ticks) {
            const run = ticks[0];
            const end = text.indexOf(run, i + run.length);
            if (end === -1 || text[end + run.length] === '`') {
                out += run;
                i += run.length;
            } else {
                out += `<code>${escapeHtml(
                    text
                        .slice(i + run.length, end)
                        .replace(/\n/g, ' ')
                        .trim(),
                )}</code>`;
                i = end + run.length;
            }
        } else if (char === '[' || (char === '!' && text[i + 1] === '[')) {
            const image = char === '!';
            const open = image ? i + 1 : i;
            const close = findClosing(text, open + 1, '[', ']', context);
            const inner = close === -1 ? '' : text.slice(open + 1, close);
            let destination: Destination | null = null;

            if (close !== -1 && text[close + 1] === '(') {
                destination = parseDestination(text, close + 1);
            } else if (close !== -1) {
                const named = text[close + 1] === '[' ? findClosing(text, close + 2, '[', ']', context) : -1;
                const key = named === -1 ? inner : text.slice(close + 2, named) || inner;
                const found = context.references.get(key.toLowerCase().replace(/\s+/g, ' '));
                if (found) destination = { ...found, end: named === -1 ? close + 1 : named + 1 };
            }

            if (destination) {
                const label = image ? escapeHtml(inner) : renderInline(inner, context, depth + 1);
                out += element(label, destination, context, image);
                i = destination.end;
            } else {
                out += escapeHtml(char);
                i++;
            }
        } else if (char === '<' && text.startsWith('<!--', i)) {
            const end = text.indexOf('-->', i + 4);
            i = end === -1 ? text.length : end + 3;
        } else if (auto) {
            out += element(escapeHtml(auto[1]), { href: auto[1], title: null }, context, false);
            i += auto[0].length;
        } else if (marks) {
            const run = marks[0];
            const size = char === '~' ? (run.length === 2 ? 2 : 0) : Math.min(run.length, 2);
            const mark = char.repeat(size);
            const gone = missing.get(mark);
            let end = -1;
            if (size > 0 && flanks(text, i, size, true) && (gone === undefined || i + size < gone)) {
                end = closing(text, i + size, mark);
                if (end === -1) missing.set(mark, i + size);
            }

            if (end !== -1) {
                const tag = char === '~' ? 'del' : size === 2 ? 'strong' : 'em';
                out += `<${tag}>${renderInline(text.slice(i + size, end), context, depth + 1)}</${tag}>`;
                i = end + size;
            } else {
                out += escapeHtml(run);
                i += run.length;
            }
        } else if (bare) {
            const address = bare[0].replace(/[.,;:!?)]+$/, '');
            out += element(escapeHtml(address), { href: address, title: null }, context, false);
            i += address.length;
        } else if (reference && decoded) {
            out += decoded;
            i += reference[0].length;
        } else if (char === '\n') {
            out += text[i - 1] === ' ' && text[i - 2] === ' ' ? '<br>\n' : '\n';
            i++;
        } else if (char === '<') {
            out += '&#60;';
            i++;
        } else {
            out += escapeHtml(char);
            i++;
        }
    }

    return out.replace(/ +<br>/g, '<br>');
}

/**
 * Tells whether a line starts a block that interrupts a paragraph.
 *
 * @param line - Line to look at
 * @returns true for a fence, a heading, a rule, a quote, or a list item that has text and is a bullet or starts at 1
 */
function interrupts(line: string): boolean {
    if (fenceOf(line) !== null || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
    const item = ITEM.exec(line);

    return item !== null && item[3] !== undefined && (!/\d/.test(item[2]) || parseInt(item[2], 10) === 1);
}

/**
 * Splits the row of a table into its cells.
 *
 * @param line - Row, with or without the outer pipes
 * @returns The trimmed cells, a pipe preceded by a backslash staying in its cell
 */
function cells(line: string): string[] {
    const body = line
        .trim()
        .replace(/^\|/, '')
        .replace(/(?<!\\)\|$/, '');

    return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/**
 * Tells whether two lines are the header and the separator of a table.
 *
 * @param line - Candidate header row
 * @param next - Line after it, undefined at the end
 * @returns true when the header holds a pipe and has as many cells as the separator
 */
function startsTable(line: string, next: string | undefined): boolean {
    return (
        next !== undefined && line.includes('|') && SEPARATOR.test(next) && cells(line).length === cells(next).length
    );
}

/**
 * Renders one row of a table.
 *
 * @param line - The row
 * @param tag - th or td
 * @param align - Class attribute of each column, empty when it has no alignment
 * @param context - Base folder and references
 * @param depth - Nesting depth
 * @returns The tr element, with as many cells as the header has
 */
function tableRow(line: string, tag: string, align: string[], context: Context, depth: number): string {
    const content = cells(line).slice(0, align.length);
    while (content.length < align.length) content.push('');
    const html = content.map((cell, n) => `<${tag}${align[n]}>${renderInline(cell, context, depth + 1)}</${tag}>`);

    return `<tr>${html.join('')}</tr>`;
}

/**
 * Renders a table whose header and separator were found.
 *
 * @param rows - Header, separator and body rows, as lines
 * @param context - Base folder and references
 * @param depth - Nesting depth
 * @returns The table element
 */
function renderTable(rows: string[], context: Context, depth: number): string {
    const align = cells(rows[1]).map((cell) => {
        if (cell.startsWith(':') && cell.endsWith(':')) return ' class="center"';
        if (cell.endsWith(':')) return ' class="right"';

        return '';
    });
    const head = `<thead>${tableRow(rows[0], 'th', align, context, depth)}</thead>`;
    const body = rows.slice(2).map((line) => tableRow(line, 'td', align, context, depth));

    return `<table>${head}${body.length > 0 ? `<tbody>${body.join('')}</tbody>` : ''}</table>\n`;
}

/**
 * Renders a heading.
 *
 * @param text - Text of the heading, marks included
 * @param level - Level in the document, from 1, before the offset is added
 * @param context - Base folder, references and heading ids
 * @param depth - Nesting depth
 * @returns The heading element, with an id made from its text
 */
function renderHeading(text: string, level: number, context: Context, depth: number): string {
    const size = Math.min(level + context.offset, 6);
    const html = renderInline(text, context, depth + 1);

    return `<h${size} id="${headingId(html, context.ids)}">${html}</h${size}>\n`;
}

/**
 * Collects the lines of one list from its first item.
 *
 * @param lines - Lines of the document
 * @param start - Index of the first item
 * @returns The items as lists of lines already dedented, whether the list is loose, whether it is ordered, the number
 * of its first item and the index after the list
 */
function collectList(lines: string[], start: number): ListBlock {
    const head = ITEM.exec(lines[start])!;
    const ordered = /\d/.test(head[2]);
    const delimiter = head[2].slice(-1);
    const items: string[][] = [];
    let loose = false;
    let width = 0;
    let i = start;

    while (i < lines.length) {
        const line = lines[i];
        const item = ITEM.exec(line);
        const same = item !== null && /\d/.test(item[2]) === ordered && item[2].slice(-1) === delimiter;
        const indent = line.length - line.trimStart().length;

        if (item && same && (items.length === 0 || item[1].length < width)) {
            const spaces = /^ */.exec(line.slice(item[1].length + item[2].length))![0].length;
            const content = item[3] ?? '';
            width = item[1].length + item[2].length + (spaces > 4 || content === '' ? 1 : spaces);
            items.push([content]);
            i++;
        } else if (line.trim() === '') {
            let next = i + 1;
            while (next < lines.length && lines[next].trim() === '') next++;
            const after = lines[next];
            const following = after === undefined ? null : ITEM.exec(after);
            const inside = after !== undefined && after.length - after.trimStart().length >= width;
            const sibling =
                following !== null &&
                following[1].length < width &&
                /\d/.test(following[2]) === ordered &&
                following[2].slice(-1) === delimiter;
            if (!inside && !sibling) break;
            loose = true;
            for (let n = i; n < next; n++) items[items.length - 1].push('');
            i = next;
        } else if (width > 0 && indent >= width) {
            items[items.length - 1].push(line.slice(width));
            i++;
        } else if (items.length > 0 && !interrupts(line) && items[items.length - 1].at(-1) !== '') {
            items[items.length - 1].push(line.trimStart());
            i++;
        } else {
            break;
        }
    }

    return { items, loose, ordered, first: parseInt(head[2], 10), end: i };
}

/**
 * Renders the blocks of a run of lines.
 *
 * @param lines - Lines without line feeds or tabs
 * @param context - Base folder, references and heading ids
 * @param depth - How deep in quotes and lists the lines are
 * @param tight - true to write paragraphs without the p element, as the items of a tight list do
 * @returns The HTML of the blocks
 */
function renderBlocks(lines: string[], context: Context, depth: number, tight: boolean): string {
    if (depth > MAX_DEPTH) return `<pre><code>${escapeHtml(lines.join('\n'))}</code></pre>\n`;

    let out = '';
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const next = lines[i + 1];
        const fence = fenceOf(line);
        const heading = HEADING.exec(line);

        if (line.trim() === '') {
            i++;
        } else if (fence) {
            const { marker } = fence;
            const indent = line.length - line.trimStart().length;
            const end = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ ]*$`);
            const code: string[] = [];
            for (i++; i < lines.length && !end.test(lines[i]); i++)
                code.push(lines[i].slice(0, indent).trim() === '' ? lines[i].slice(indent) : lines[i]);
            i++;
            const language = /^[a-z0-9_+#.-]{1,30}$/i.test(fence.language)
                ? ` class="language-${fence.language.toLowerCase()}"`
                : '';
            out += `<pre><code${language}>${escapeHtml(code.join('\n'))}${code.length > 0 ? '\n' : ''}</code></pre>\n`;
        } else if (line.trimStart().startsWith('<!--')) {
            while (i < lines.length && !lines[i].includes('-->')) i++;
            i++;
        } else if (heading) {
            const text = heading[2].trim().replace(/ +#+$/, '');
            out += renderHeading(text.replace(/^#+$/, ''), heading[1].length, context, depth);
            i++;
        } else if (RULE.test(line)) {
            out += '<hr>\n';
            i++;
        } else if (QUOTE.test(line)) {
            const quoted: string[] = [];
            for (; i < lines.length && lines[i].trim() !== ''; i++) {
                const quote = QUOTE.test(lines[i]);
                if (!quote && (interrupts(lines[i]) || quoted[quoted.length - 1].trim() === '')) break;
                quoted.push(quote ? lines[i].replace(/^ {0,3}> ?/, '') : lines[i]);
            }
            out += `<blockquote>\n${renderBlocks(quoted, context, depth + 1, false)}</blockquote>\n`;
        } else if (ITEM.test(line)) {
            const list = collectList(lines, i);
            const tag = list.ordered ? 'ol' : 'ul';
            const start = list.ordered && list.first !== 1 ? ` start="${list.first}"` : '';
            const items = list.items.map(
                (item) => `<li>${renderBlocks(item, context, depth + 1, !list.loose).trim()}</li>\n`,
            );
            out += `<${tag}${start}>\n${items.join('')}</${tag}>\n`;
            i = list.end;
        } else if (line.startsWith('    ')) {
            const code: string[] = [];
            for (; i < lines.length && (lines[i].startsWith('    ') || lines[i].trim() === ''); i++)
                code.push(lines[i].slice(4));
            while (code.length > 0 && code[code.length - 1].trim() === '') code.pop();
            out += `<pre><code>${escapeHtml(code.join('\n'))}\n</code></pre>\n`;
        } else if (startsTable(line, next)) {
            const rows = [line, next];
            for (
                i += 2;
                i < lines.length && lines[i].trim() !== '' && lines[i].includes('|') && !interrupts(lines[i]);
                i++
            )
                rows.push(lines[i]);
            out += renderTable(rows, context, depth);
        } else {
            const text: string[] = [line.trimStart()];
            let level = 0;
            for (i++; i < lines.length && lines[i].trim() !== ''; i++) {
                const setext = SETEXT.exec(lines[i]);
                if (setext) {
                    level = setext[1][0] === '=' ? 1 : 2;
                    i++;
                    break;
                }
                if (interrupts(lines[i]) || lines[i].trimStart().startsWith('<!--')) break;
                if (startsTable(lines[i], lines[i + 1])) break;
                text.push(lines[i].trimStart());
            }
            const joined = text.join('\n').trimEnd();
            if (level > 0) out += renderHeading(joined, level, context, depth);
            else
                out += tight
                    ? `${renderInline(joined, context, depth + 1)}\n`
                    : `<p>${renderInline(joined, context, depth + 1)}</p>\n`;
        }
    }

    return out;
}

/**
 * Replaces the tabs of a line by the spaces that reach the next tab stop, every 4 columns.
 *
 * @param line - A line without line feeds
 * @returns The line without tabs
 */
function expandTabs(line: string): string {
    if (!line.includes('\t')) return line;

    let out = '';
    for (const char of line) out += char === '\t' ? ' '.repeat(4 - (out.length % 4)) : char;

    return out;
}

/**
 * Reads the reference definitions of a document, which are not part of the text.
 *
 * @param lines - Lines of the document
 * @param context - Receives the definitions, keyed by their lower case label
 * @returns The lines without the definitions, fenced code left as it is
 */
function takeDefinitions(lines: string[], context: Context): string[] {
    const kept: string[] = [];
    let fence: string | null = null;

    for (const line of lines) {
        const opening = fenceOf(line);
        if (fence === null && opening) fence = opening.marker[0];
        else if (fence !== null && new RegExp(`^ {0,3}${fence}{3,}[ ]*$`).test(line)) fence = null;

        const definition = fence === null && !opening ? DEFINITION.exec(line) : null;
        if (definition) {
            const key = definition[1].toLowerCase().replace(/\s+/g, ' ');
            const title = definition[3] === undefined ? null : definition[3].slice(1, -1);
            if (!context.references.has(key))
                context.references.set(key, { href: definition[2].replace(/^<|>$/g, ''), title });
        } else {
            kept.push(line);
        }
    }

    return kept;
}

/**
 * Renders a Markdown document to HTML that is safe to put in a page.
 * It reads headings, paragraphs, quotes, lists, tables, fenced and indented code, rules, emphasis, code, links, images
 * and reference definitions. Raw HTML is never passed through: it is written as text, but for comments, which vanish.
 * Links follow only http, https and mailto, and relative addresses resolve against a base folder. A line is read up to
 * 5000 characters and a block up to 10000 for its marks, so that no text takes long to render.
 *
 * @param source - Markdown text, cut off past 256 KiB
 * @param options - base is the folder that relative addresses resolve against, ending with a slash and / by default;
 * offset is added to the level of every heading, 0 by default, with h6 as the deepest
 * @returns The HTML, made only of block and inline elements written here, every text being escaped
 */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
    const context: Context = {
        base: options.base ?? '/',
        offset: options.offset ?? 0,
        references: new Map(),
        ids: new Map(),
        scan: 0,
    };
    const lines = source
        .slice(0, MAX_SOURCE)
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => expandTabs(line.slice(0, MAX_LINE)));

    return renderBlocks(takeDefinitions(lines, context), context, 0, false);
}
