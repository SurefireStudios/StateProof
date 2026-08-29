import { inflateRawSync } from 'node:zlib';

/**
 * A minimal, defensive ZIP reader for uploaded run packages.
 *
 * Written by hand rather than pulled in, because the threat model is the whole
 * point: an uploaded archive is hostile input, and the interesting failures —
 * path traversal, absolute paths, decompression bombs, entry counts — are
 * decided by the *reader's* policy, not by the format. Doing it here keeps
 * every limit visible and testable.
 *
 * Only the two methods a real run package uses are supported: stored (0) and
 * deflate (8). Anything else is rejected rather than guessed at.
 */

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 64,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
};

export class ZipError extends Error {
  public readonly field: string;

  public constructor(field: string, message: string) {
    super(message);
    this.name = 'ZipError';
    this.field = field;
  }
}

/** Rejects anything that could escape the extraction root, before any read. */
export function assertSafeEntryName(name: string): string {
  if (name.length === 0 || name.length > 255) {
    throw new ZipError('archive', `entry name is not a usable length: "${name.slice(0, 40)}"`);
  }
  if (name.includes('\0')) throw new ZipError('archive', 'entry name contains a null byte');
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new ZipError('archive', `absolute path in archive: "${normalized}"`);
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new ZipError('archive', `path traversal in archive: "${normalized}"`);
  }
  return normalized;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The comment field means the record is not at a fixed offset.
  const minimum = 22;
  const start = Math.max(0, buffer.length - (minimum + 0xffff));
  for (let offset = buffer.length - minimum; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipError('archive', 'not a ZIP archive: no end-of-central-directory record');
}

export interface ZipEntry {
  readonly name: string;
  readonly contents: Buffer;
}

export function readZip(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  if (buffer.length === 0) throw new ZipError('archive', 'the uploaded archive is empty');
  if (buffer.length > limits.maxTotalBytes) {
    throw new ZipError('archive', `archive is larger than ${limits.maxTotalBytes} bytes`);
  }

  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (entryCount > limits.maxEntries) {
    throw new ZipError('archive', `archive holds ${entryCount} entries; the limit is ${limits.maxEntries}`);
  }

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError('archive', 'the central directory is malformed');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    const name = assertSafeEntryName(rawName);
    if (name.endsWith('/')) continue; // directory entry

    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError('archive', `"${name}" expands to more than ${limits.maxEntryBytes} bytes`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new ZipError('archive', 'the archive expands to more than the total size limit');
    }
    if (method !== 0 && method !== 8) {
      throw new ZipError('archive', `"${name}" uses unsupported compression method ${method}`);
    }

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipError('archive', `"${name}" has a malformed local header`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new ZipError('archive', `"${name}" is truncated`);

    const raw = buffer.subarray(dataStart, dataEnd);
    let contents: Buffer;
    try {
      contents = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes });
    } catch {
      throw new ZipError('archive', `"${name}" could not be decompressed`);
    }
    if (contents.length > limits.maxEntryBytes) {
      throw new ZipError('archive', `"${name}" is larger than ${limits.maxEntryBytes} bytes`);
    }

    entries.push({ name, contents });
  }

  if (entries.length === 0) throw new ZipError('archive', 'the archive contains no files');
  return entries;
}
