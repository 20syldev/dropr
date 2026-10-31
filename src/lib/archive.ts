import type { CatalogVersion, IndexDir, TarEntry, TarRead } from '../types/index.js';

const BLOCK = 512;

// GNU tar's default record of 20 blocks, the unit an archive length is padded to
const RECORD = 20 * BLOCK;

const SLASH = 0x2f;

// Typeflag of each entry kind in a ustar header
const TYPEFLAGS: Record<TarEntry['kind'], string> = { dir: '5', file: '0', link: '2' };

const encoder = new TextEncoder();

/**
 * Adds the entries below a folder of a version to an archive list, in pre-order and strcmp order.
 * Links are kept as links, whatever they point to, so nothing is written below a link to a folder.
 *
 * @param version - Version holding the folder, whose type and project start the file sources
 * @param dir - Folder whose entries are added, its subfolders included
 * @param path - Archive path of dir, the version name first and without a trailing slash
 * @param mtime - Modification time given to every entry, in whole seconds since the epoch
 * @param entries - List filled in place
 * @returns False when a folder below could not be listed at scan, leaving entries partial
 */
function addEntries(version: CatalogVersion, dir: IndexDir, path: string, mtime: number, entries: TarEntry[]): boolean {
    if (dir.entries === null) return false;

    for (const node of dir.entries) {
        const child = `${path}/${node.name}`;
        if (node.kind === 'dir') {
            entries.push({ kind: 'dir', path: `${child}/`, mode: 0o755, mtime, size: 0, target: null, source: null });
            if (!addEntries(version, node, child, mtime, entries)) return false;
        } else if (node.kind === 'file') {
            const mode = node.exec ? 0o755 : 0o644;
            const source = `${version.type}/${version.project}/${child}`;
            entries.push({ kind: 'file', path: child, mode, mtime, size: node.size, target: null, source });
        } else {
            entries.push({ kind: 'link', path: child, mode: 0o777, mtime, size: 0, target: node.target, source: null });
        }
    }

    return true;
}

/**
 * Lists the archive entries of a version from its index, the version folder first.
 * Every entry carries the release date of the version rather than its file date, so a version gives the same tar
 * bytes on every deploy, whatever date the checkout gave the files.
 *
 * @param version - Version to archive, its date a YYYY-MM-DD day; a date that does not parse, or one before 1970,
 * gives the epoch
 * @returns Entries in archive order, file sources relative to the packages root, or null when a folder of the version
 * could not be listed at scan
 */
export function archiveEntries(version: CatalogVersion): TarEntry[] | null {
    const seconds = Math.floor(Date.parse(version.date) / 1000);
    const mtime = Number.isNaN(seconds) ? 0 : Math.max(0, seconds);
    const entries: TarEntry[] = [
        { kind: 'dir', path: `${version.name}/`, mode: 0o755, mtime, size: 0, target: null, source: null },
    ];

    return addEntries(version, version.root, version.name, mtime, entries) ? entries : null;
}

/**
 * Writes a number as a zero-padded octal field of a tar header.
 * The field ends with the NUL byte that the zeroed block already holds.
 *
 * @param block - Zeroed header block, written in place
 * @param offset - Offset of the field in the block
 * @param width - Field width in bytes, the last one kept as the NUL terminator
 * @param value - Integer written in width - 1 octal digits; a negative, fractional or larger value throws a RangeError
 */
function writeOctal(block: Uint8Array, offset: number, width: number, value: number): void {
    const digits = width - 1;
    if (!Number.isSafeInteger(value) || value < 0 || value >= 8 ** digits) {
        throw new RangeError(`${value} does not fit in a tar header field of ${digits} octal digits`);
    }

    block.set(encoder.encode(value.toString(8).padStart(digits, '0')), offset);
}

/**
 * Writes the checksum field of a header block.
 * The checksum is the sum of the block bytes, its own field counted as 8 spaces.
 *
 * @param block - Header block with every other field written, updated in place
 */
function writeChecksum(block: Uint8Array): void {
    block.fill(0x20, 148, 156);
    const sum = block.reduce((total, byte) => total + byte, 0);

    block.set(encoder.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
}

/**
 * Cuts UTF-8 text to a byte length without splitting a character.
 *
 * @param bytes - UTF-8 encoded text
 * @param max - Largest length kept, in bytes
 * @returns The bytes themselves when they fit, else their longest prefix that ends on a character boundary
 */
function truncate(bytes: Uint8Array, max: number): Uint8Array {
    if (bytes.length <= max) return bytes;

    let end = max;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;

    return bytes.subarray(0, end);
}

/**
 * Finds where a path too long for the name field splits into the prefix and name fields of a ustar header.
 * The leftmost slash that leaves a name of at most 100 bytes gives the shortest prefix, so it fits when any split does.
 *
 * @param path - UTF-8 path, over 100 bytes
 * @returns Offset of the slash left out between prefix and name, or -1 when the name would be empty or the prefix
 * empty or over 155 bytes
 */
function splitName(path: Uint8Array): number {
    for (let slash = 1; slash < path.length; slash++) {
        if (path[slash] !== SLASH || path.length - slash - 1 > 100) continue;

        return slash < path.length - 1 && slash <= 155 ? slash : -1;
    }

    return -1;
}

/**
 * Formats a pax extended header record.
 * Its leading decimal length counts the whole record, its own digits included.
 *
 * @param key - Record keyword, path or linkpath here
 * @param value - Full value, of any length, UTF-8 encoded here
 * @returns The record bytes, '<length> <key>=<value>' followed by a newline
 */
function paxRecord(key: string, value: string): Uint8Array<ArrayBuffer> {
    const body = encoder.encode(` ${key}=${value}\n`).length;
    let length = body;
    while (String(length).length + body !== length) length = String(length).length + body;

    return encoder.encode(`${length} ${key}=${value}\n`);
}

/**
 * Joins byte arrays into a new one.
 *
 * @param parts - Arrays copied in order, empty ones included
 * @returns An array as long as all the parts together
 */
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
    }

    return joined;
}

/**
 * Counts the zero bytes that complete data to whole 512-byte blocks.
 *
 * @param length - Data length in bytes
 * @returns From 0, for a length that is a multiple of 512, to 511
 */
function padding(length: number): number {
    return (BLOCK - (length % BLOCK)) % BLOCK;
}

/**
 * Builds a ustar header block, owned by uid and gid 0 with empty user and group names.
 * A path over 100 bytes goes in the prefix and name fields when it splits, else only its first 100 bytes are kept.
 *
 * @param type - Typeflag character: '0' file, '5' folder, '2' symbolic link or 'x' pax header
 * @param path - UTF-8 entry path, a folder path ending with a slash
 * @param target - UTF-8 link target, empty for other kinds; only its first 100 bytes are kept
 * @param mode - Permission bits, such as 0o644
 * @param size - Data length in bytes, 0 for a folder or a link; 8 GiB or more throws a RangeError
 * @param mtime - Modification time in whole seconds since the epoch; a negative or fractional value throws a RangeError
 * @returns The 512-byte block, checksum included
 */
function header(
    type: string,
    path: Uint8Array,
    target: Uint8Array,
    mode: number,
    size: number,
    mtime: number,
): Uint8Array<ArrayBuffer> {
    const block = new Uint8Array(BLOCK);
    const split = path.length > 100 ? splitName(path) : -1;

    block.set(truncate(split === -1 ? path : path.subarray(split + 1), 100), 0);
    writeOctal(block, 100, 8, mode);
    writeOctal(block, 108, 8, 0);
    writeOctal(block, 116, 8, 0);
    writeOctal(block, 124, 12, size);
    writeOctal(block, 136, 12, mtime);
    block.set(encoder.encode(type), 156);
    block.set(truncate(target, 100), 157);
    block.set(encoder.encode('ustar'), 257);
    block.set(encoder.encode('00'), 263);
    writeOctal(block, 329, 8, 0);
    writeOctal(block, 337, 8, 0);
    if (split !== -1) block.set(path.subarray(0, split), 345);
    writeChecksum(block);

    return block;
}

/**
 * Builds the header blocks of an entry.
 * A pax header named PaxHeader comes first when the path or the link target does not fit the ustar fields.
 *
 * @param entry - Entry to describe, its size written for a file only and its mtime taken as given
 * @returns One ustar block, or a pax header, its records padded to whole blocks and the ustar block
 */
function entryHeader(entry: TarEntry): Uint8Array<ArrayBuffer> {
    const link = entry.target ?? '';
    const path = encoder.encode(entry.path);
    const target = encoder.encode(link);
    const size = entry.kind === 'file' ? entry.size : 0;
    const ustar = header(TYPEFLAGS[entry.kind], path, target, entry.mode, size, entry.mtime);

    const records: Uint8Array[] = [];
    if (path.length > 100 && splitName(path) === -1) records.push(paxRecord('path', entry.path));
    if (target.length > 100) records.push(paxRecord('linkpath', link));
    if (records.length === 0) return ustar;

    const data = concat(records);
    const pax = header('x', encoder.encode('PaxHeader'), new Uint8Array(0), 0o644, data.length, entry.mtime);

    return concat([pax, data, new Uint8Array(padding(data.length)), ustar]);
}

/**
 * Reads the content of a file entry and checks it against the size its header announces.
 *
 * @param entry - File entry whose source is read
 * @param read - Reader given to archiveStream, called even for an empty file so that an unreadable one still fails
 * @returns The file bytes; rejects when the entry has no source, the read fails or the length differs from the size
 */
async function fileData(entry: TarEntry, read: TarRead): Promise<Uint8Array<ArrayBuffer>> {
    if (entry.source === null) throw new Error(`${entry.path} has no source to read`);

    const data = await read(entry.source);
    if (data.length !== entry.size) {
        throw new Error(`${entry.source} has ${data.length} bytes, the index has ${entry.size}`);
    }

    return data;
}

/**
 * Streams a gzipped tar archive of the given entries, one entry per pull, so at most one file is held in memory.
 * The tar bytes depend only on the entries and the file contents: no clock, owner, umask or disk order goes in.
 *
 * @param entries - Entries in archive order, written as given; null, for a version that cannot be archived, errors the
 * stream on its first pull
 * @param read - Returns the whole content of a file entry source; a rejection, or a length other than the entry size,
 * errors the stream
 * @returns Gzip bytes of an archive ended by two zero blocks and padded to a multiple of 10240 bytes; an error midway
 * leaves it truncated, which the caller must report as a failed download
 */
export function archiveStream(entries: TarEntry[] | null, read: TarRead): ReadableStream<Uint8Array<ArrayBuffer>> {
    let next = 0;
    let written = 0;

    const tar = new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
            if (!entries) throw new Error('The version is unknown or has a folder that could not be read');

            if (next === entries.length) {
                controller.enqueue(new Uint8Array(Math.ceil((written + 2 * BLOCK) / RECORD) * RECORD - written));
                controller.close();
                return;
            }

            const entry = entries[next++];
            const blocks = [entryHeader(entry)];
            if (entry.kind === 'file') {
                const data = await fileData(entry, read);
                blocks.push(data, new Uint8Array(padding(data.length)));
            }

            for (const block of blocks) {
                if (block.length > 0) controller.enqueue(block);
                written += block.length;
            }
        },
    });

    return tar.pipeThrough(new CompressionStream('gzip'));
}
