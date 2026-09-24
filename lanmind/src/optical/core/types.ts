export const LMFT_VERSION = 1;
export const DESCRIPTOR_LENGTH = 128;
export const PACKET_HEADER_LENGTH = 64;
export const PACKET_TRAILER_LENGTH = 4;
export const CONTROL_SYMBOL_SIZE = 256;
export const DATA_SYMBOL_SIZES = [448, 704, 960, 1408, 1856] as const;
export const MAX_FILE_SIZE = 1024 * 1024 * 1024;
export const RECOMMENDED_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_BLOCKS = 4096;
export const MAX_MANIFEST_WIRE_LENGTH = 2 * 1024 * 1024;
export const MAX_DATA_OBJECT_LENGTH = 4 * 1024 * 1024 + 16;
export const PBKDF2_ITERATIONS = 600_000;

export type CryptoSuite = 0 | 1;
export type Compression = 0 | 1;
export type PacketKind = 0 | 1 | 2;

export interface Descriptor {
  version: number;
  cryptoSuite: CryptoSuite;
  kdf: number;
  transferId: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  noncePrefix: Uint8Array;
  rawBlockSize: number;
  blockCount: number;
  originalSize: bigint;
  manifestWireLength: number;
  manifestWireSha256: Uint8Array;
  dataSymbolSize: number;
  controlSymbolSize: number;
  flags: number;
}

export interface ManifestRecord {
  generationIndex: number;
  rawOffset: bigint;
  rawLength: number;
  wireLength: number;
  compression: Compression;
  rawSha256: Uint8Array;
  wireSha256: Uint8Array;
}

export interface Manifest {
  version: number;
  flags: number;
  transferId: Uint8Array;
  originalSize: bigint;
  rawBlockSize: number;
  blockCount: number;
  fileName: string;
  mime: string;
  originalFileSha256: Uint8Array;
  records: ManifestRecord[];
}

export interface PacketHeader {
  wireVersion: number;
  kind: PacketKind;
  transferId: Uint8Array;
  objectId: number;
  encodedLength: number;
  symbolSize: number;
  fecProfile: number;
  flags: number;
  objectTag: Uint8Array;
  sourceBlockNumber: number;
  encodingSymbolId: number;
}

export interface ParsedPacket {
  header: PacketHeader;
  symbol: Uint8Array;
}

export interface PreparedBlock {
  objectId: number;
  rawOffset: bigint;
  rawLength: number;
  compression: Compression;
  rawSha256: Uint8Array;
  wire: Uint8Array;
  wireSha256: Uint8Array;
}

export interface PreparedTransfer {
  descriptor: Descriptor;
  descriptorBytes: Uint8Array;
  manifest: Manifest;
  manifestPlainBytes: Uint8Array;
  manifestWire: Uint8Array;
  blocks: PreparedBlock[];
  key?: CryptoKey;
  /** Optional persistent object backing used by large-file preparation. */
  objectStore?: import('../storage/objectStore').OpticalObjectStore;
  loadBlock?: (block: PreparedBlock) => Promise<Uint8Array>;
}

export interface ReceiverObject {
  key: string;
  header: PacketHeader;
  bytes?: Uint8Array;
  receivedSymbols: number;
}

export function objectIdForGeneration(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_BLOCKS) throw new RangeError('generation index out of range');
  return index + 2;
}

export function generationForObjectId(objectId: number): number {
  if (!Number.isInteger(objectId) || objectId < 2) throw new RangeError('data object id out of range');
  return objectId - 2;
}
