/**
 * zipUtils — Pure TypeScript lightweight ZIP file archive builder.
 *
 * CALLING SPEC:
 *   const zip = new ZipArchive();
 *   zip.addFile('folder/note.md', 'string or Uint8Array or Blob');
 *   zip.addFile('assets/photo.png', imageBlob);
 *   const zipBytes = await zip.generateAsync(); // Uint8Array
 *
 * TOOL CONTRACT:
 *   - Follows standard PKWARE ZIP format (compression method 0: Store, 100% portable)
 *   - Full UTF-8 support for Chinese and special characters (EFS flag 0x0800)
 *   - Preserves directory structures with forward slashes ('/')
 *   - Deterministic and pure; zero external npm dependencies
 *   - Independently unit testable
 */

// CRC-32 table generator and calculation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array | string | Blob;
  lastModified?: Date;
}

interface ProcessedZipEntry {
  nameBytes: Uint8Array;
  dataBytes: Uint8Array;
  crc32: number;
  dosTime: number;
  dosDate: number;
  offset: number;
}

function dateToDos(date: Date): { dosTime: number; dosDate: number } {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((Math.max(1980, year) - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

export class ZipArchive {
  private entries: ZipEntryInput[] = [];

  /**
   * Add a file or nested path to the ZIP archive.
   * Path should use forward slashes (e.g., 'docs/architecture/design.md')
   */
  addFile(name: string, data: Uint8Array | string | Blob, lastModified?: Date): this {
    const cleanName = name.replace(/\\/g, '/').replace(/^\/+/, '');
    this.entries.push({ name: cleanName, data, lastModified });
    return this;
  }

  /**
   * Generates the binary Uint8Array representing the complete ZIP archive.
   */
  async generateAsync(): Promise<Uint8Array> {
    const textEncoder = new TextEncoder();
    const processed: ProcessedZipEntry[] = [];
    const localChunks: Uint8Array[] = [];
    let currentOffset = 0;

    for (const entry of this.entries) {
      let dataBytes: Uint8Array;
      if (typeof entry.data === 'string') {
        dataBytes = textEncoder.encode(entry.data);
      } else if (entry.data instanceof Uint8Array) {
        dataBytes = entry.data;
      } else if (entry.data instanceof Blob) {
        const buffer = await entry.data.arrayBuffer();
        dataBytes = new Uint8Array(buffer);
      } else {
        dataBytes = new Uint8Array(0);
      }

      const nameBytes = textEncoder.encode(entry.name);
      const crc = computeCrc32(dataBytes);
      const { dosTime, dosDate } = dateToDos(entry.lastModified || new Date());

      const item: ProcessedZipEntry = {
        nameBytes,
        dataBytes,
        crc32: crc,
        dosTime,
        dosDate,
        offset: currentOffset,
      };
      processed.push(item);

      // Local File Header (30 bytes + name length + data length)
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);

      view.setUint32(0, 0x04034b50, true); // Local file header signature
      view.setUint16(4, 20, true);         // Version needed to extract (2.0)
      view.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8 enabled)
      view.setUint16(8, 0, true);          // Compression method (0 = Store)
      view.setUint16(10, dosTime, true);   // File last mod time
      view.setUint16(12, dosDate, true);   // File last mod date
      view.setUint32(14, crc, true);       // CRC-32
      view.setUint32(18, dataBytes.length, true); // Compressed size
      view.setUint32(22, dataBytes.length, true); // Uncompressed size
      view.setUint16(26, nameBytes.length, true); // File name length
      view.setUint16(28, 0, true);         // Extra field length

      header.set(nameBytes, 30);
      localChunks.push(header);
      localChunks.push(dataBytes);

      currentOffset += header.length + dataBytes.length;
    }

    const centralDirectoryStart = currentOffset;
    const centralChunks: Uint8Array[] = [];
    let centralDirectorySize = 0;

    // Central Directory Headers
    for (const item of processed) {
      const header = new Uint8Array(46 + item.nameBytes.length);
      const view = new DataView(header.buffer);

      view.setUint32(0, 0x02014b50, true); // Central directory header signature
      view.setUint16(4, 20, true);         // Version made by
      view.setUint16(6, 20, true);         // Version needed to extract
      view.setUint16(8, 0x0800, true);     // General purpose bit flag (UTF-8)
      view.setUint16(10, 0, true);         // Compression method (Store)
      view.setUint16(12, item.dosTime, true);
      view.setUint16(14, item.dosDate, true);
      view.setUint32(16, item.crc32, true);
      view.setUint32(20, item.dataBytes.length, true); // Compressed size
      view.setUint32(24, item.dataBytes.length, true); // Uncompressed size
      view.setUint16(28, item.nameBytes.length, true); // File name length
      view.setUint16(30, 0, true);         // Extra field length
      view.setUint16(32, 0, true);         // Comment length
      view.setUint16(34, 0, true);         // Disk number start
      view.setUint16(36, 0, true);         // Internal file attributes
      view.setUint32(38, 0, true);         // External file attributes
      view.setUint32(42, item.offset, true); // Relative offset of local header

      header.set(item.nameBytes, 46);
      centralChunks.push(header);
      centralDirectorySize += header.length;
    }

    // End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // End of central dir signature
    eocdView.setUint16(4, 0, true);          // Number of this disk
    eocdView.setUint16(6, 0, true);          // Disk where central directory starts
    eocdView.setUint16(8, processed.length, true);  // Number of central directory records on this disk
    eocdView.setUint16(10, processed.length, true); // Total number of central directory records
    eocdView.setUint32(12, centralDirectorySize, true); // Size of central directory
    eocdView.setUint32(16, centralDirectoryStart, true); // Offset of start of central directory
    eocdView.setUint16(20, 0, true);         // Comment length

    // Assemble all buffers
    const totalSize = centralDirectoryStart + centralDirectorySize + eocd.length;
    const finalBuffer = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of localChunks) {
      finalBuffer.set(chunk, offset);
      offset += chunk.length;
    }
    for (const chunk of centralChunks) {
      finalBuffer.set(chunk, offset);
      offset += chunk.length;
    }
    finalBuffer.set(eocd, offset);

    return finalBuffer;
  }
}
