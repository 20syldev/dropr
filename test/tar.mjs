import zlib from 'zlib';

import { sha256 } from './server.mjs';

/**
 * Reads a NUL-terminated text field of a tar header.
 *
 * @param header - 512-byte header block
 * @param start - Offset of the field in the block
 * @param length - Field width in bytes, the value ending at its first NUL byte if any
 * @returns The field value, empty when the field is blank
 */
function field(header, start, length) {
    return header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
}

/**
 * Lists the entries of a .tar.gz archive, as served by the download routes.
 * Reads ustar and GNU headers with GNU long names and link targets (L, K) and pax records (x). Modes, owners and dates
 * are left out since they depend on the machine that built the archive.
 *
 * @param archive - Gzipped tar bytes, throws if they are not valid gzip or hold an entry type not listed above
 * @returns Entries sorted by path: a file with its size and SHA-256, a dir, or a link with its target
 */
export function readArchive(archive) {
    const tar = zlib.gunzipSync(archive);
    const entries = [];
    let longPath = null;
    let longTarget = null;

    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;

        const size = parseInt(field(header, 124, 12).trim() || '0', 8);
        const type = field(header, 156, 1) || '0';
        const data = tar.subarray(offset + 512, offset + 512 + size);
        offset += 512 + Math.ceil(size / 512) * 512;

        if (type === 'L' || type === 'K') {
            const value = data.toString('utf8').replace(/\0.*$/s, '');
            if (type === 'L') longPath = value;
            else longTarget = value;
            continue;
        }
        if (type === 'x') {
            const records = data.toString('utf8');
            longPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(records)?.[1] ?? longPath;
            longTarget = /(?:^|\n)\d+ linkpath=([^\n]*)\n/.exec(records)?.[1] ?? longTarget;
            continue;
        }
        if (type === 'g') continue;

        // Only POSIX ustar headers have a path prefix, GNU headers keep other fields at that offset
        const prefix = header.subarray(257, 263).toString('latin1') === 'ustar\0' ? field(header, 345, 155) : '';
        const path = longPath ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
        const target = longTarget ?? field(header, 157, 100);
        longPath = null;
        longTarget = null;

        if (type === '0' || type === '7') entries.push({ path, type: 'file', size, sha256: sha256(data) });
        else if (type === '5') entries.push({ path, type: 'dir' });
        else if (type === '1' || type === '2') entries.push({ path, type: 'link', target });
        else throw new Error(`Unsupported tar entry type '${type}' at ${path}`);
    }

    return entries.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Reads a web stream to its end.
 *
 * @param stream - Stream of byte chunks
 * @returns The chunks joined; rejects with the error of the stream
 */
export async function collect(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    return Buffer.concat(chunks);
}
