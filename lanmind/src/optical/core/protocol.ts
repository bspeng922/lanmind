import { ByteReader, ByteWriter, equalBytes, textDecoder, textEncoder } from './bytes';
import { crc32c } from './crc32c';
import { hash } from './hash';
import {
  CONTROL_SYMBOL_SIZE,
  DATA_SYMBOL_SIZES,
  DESCRIPTOR_LENGTH,
  MAX_BLOCKS,
  MAX_DATA_OBJECT_LENGTH,
  MAX_PROTOCOL_FILE_SIZE,
  MAX_MANIFEST_WIRE_LENGTH,
  PBKDF2_ITERATIONS,
  PACKET_HEADER_LENGTH,
  PACKET_TRAILER_LENGTH,
  RAW_BLOCK_SIZES,
  type Descriptor,
  type Manifest,
  type ManifestRecord,
  type PacketHeader,
  type PacketKind,
  type ParsedPacket,
} from './types';

const MAGIC_PACKET = new Uint8Array([0x4c, 0x4d, 0x46, 0x54]);
const MAGIC_DESCRIPTOR = new Uint8Array([0x4c, 0x4d, 0x44, 0x53]);
const MAGIC_MANIFEST = new Uint8Array([0x4c, 0x4d, 0x46, 0x4d]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validTransferId(value: Uint8Array): void { assert(value.length === 16, 'transfer id must be 16 bytes'); }
function validHash(value: Uint8Array): void { assert(value.length === 32, 'hash must be 32 bytes'); }

function validateLayout(originalSize: bigint, rawBlockSize: number, blockCount: number): void {
  assert(RAW_BLOCK_SIZES.includes(rawBlockSize as typeof RAW_BLOCK_SIZES[number]), 'invalid raw block size');
  assert(Number.isInteger(blockCount) && blockCount >= 0 && blockCount <= MAX_BLOCKS, 'invalid block count');
  assert(originalSize >= 0n && originalSize <= BigInt(MAX_PROTOCOL_FILE_SIZE), 'file layout limit');
  const expected = originalSize === 0n ? 0 : Number((originalSize + BigInt(rawBlockSize) - 1n) / BigInt(rawBlockSize));
  assert(blockCount === expected, 'inconsistent block layout');
}

function validateDescriptor(descriptor: Descriptor): void {
  validTransferId(descriptor.transferId);
  assert(descriptor.salt.length === 16 && descriptor.noncePrefix.length === 8, 'invalid descriptor crypto fields');
  validHash(descriptor.manifestWireSha256);
  assert(descriptor.version === 1 && descriptor.flags === 0, 'unsupported descriptor version');
  assert(descriptor.cryptoSuite === 0 || descriptor.cryptoSuite === 1, 'unsupported crypto suite');
  validateLayout(descriptor.originalSize, descriptor.rawBlockSize, descriptor.blockCount);
  assert(descriptor.manifestWireLength >= 0 && descriptor.manifestWireLength <= MAX_MANIFEST_WIRE_LENGTH, 'manifest size limit');
  assert(descriptor.controlSymbolSize === CONTROL_SYMBOL_SIZE, 'invalid control symbol size');
  assert(DATA_SYMBOL_SIZES.includes(descriptor.dataSymbolSize as typeof DATA_SYMBOL_SIZES[number]), 'invalid data symbol size');
  if (descriptor.cryptoSuite === 0) {
    assert(descriptor.kdf === 0 && descriptor.iterations === 0 && descriptor.salt.every((x) => x === 0) && descriptor.noncePrefix.every((x) => x === 0), 'invalid plain descriptor crypto fields');
  } else {
    assert(descriptor.kdf === 1 && descriptor.iterations === PBKDF2_ITERATIONS, 'invalid encrypted descriptor crypto fields');
  }
}

export function encodeDescriptor(descriptor: Descriptor): Uint8Array {
  validateDescriptor(descriptor);
  const writer = new ByteWriter(DESCRIPTOR_LENGTH);
  writer.raw(MAGIC_DESCRIPTOR).u8(descriptor.version).u8(descriptor.cryptoSuite).u8(descriptor.kdf).u8(0)
    .raw(descriptor.transferId).raw(descriptor.salt).u32(descriptor.iterations).raw(descriptor.noncePrefix)
    .u32(descriptor.rawBlockSize).u32(descriptor.blockCount).u64(descriptor.originalSize)
    .u32(descriptor.manifestWireLength).raw(descriptor.manifestWireSha256)
    .u16(descriptor.dataSymbolSize).u16(descriptor.controlSymbolSize).u32(descriptor.flags).raw(new Uint8Array(16));
  return writer.finish();
}

export function decodeDescriptor(bytes: Uint8Array): Descriptor {
  assert(bytes.length === DESCRIPTOR_LENGTH, 'invalid descriptor length');
  const reader = new ByteReader(bytes);
  assert(equalBytes(reader.raw(4), MAGIC_DESCRIPTOR), 'invalid descriptor magic');
  const version = reader.u8();
  const cryptoSuite = reader.u8() as 0 | 1;
  const kdf = reader.u8();
  assert(reader.u8() === 0, 'descriptor reserved field is non-zero');
  const transferId = reader.raw(16);
  const salt = reader.raw(16);
  const iterations = reader.u32();
  const noncePrefix = reader.raw(8);
  const rawBlockSize = reader.u32();
  const blockCount = reader.u32();
  const originalSize = reader.u64();
  const manifestWireLength = reader.u32();
  const manifestWireSha256 = reader.raw(32);
  const dataSymbolSize = reader.u16();
  const controlSymbolSize = reader.u16();
  const flags = reader.u32();
  assert(reader.raw(16).every((value) => value === 0), 'descriptor reserved bytes are non-zero');
  const descriptor = { version, cryptoSuite, kdf, transferId, salt, iterations, noncePrefix, rawBlockSize, blockCount, originalSize, manifestWireLength, manifestWireSha256, dataSymbolSize, controlSymbolSize, flags } as Descriptor;
  validateDescriptor(descriptor);
  assert(manifestWireLength > 0, 'descriptor manifest is not finalized');
  return descriptor;
}

export function encodeManifest(manifest: Manifest): Uint8Array {
  validTransferId(manifest.transferId);
  validHash(manifest.originalFileSha256);
  assert(manifest.version === 1 && manifest.flags === 0, 'unsupported manifest');
  validateLayout(manifest.originalSize, manifest.rawBlockSize, manifest.blockCount);
  const name = textEncoder.encode(manifest.fileName);
  const mime = textEncoder.encode(manifest.mime);
  assert(name.length > 0 && name.length <= 1024 && mime.length <= 255, 'manifest text length limit');
  assert(manifest.records.length === manifest.blockCount && manifest.blockCount <= MAX_BLOCKS, 'manifest block count');
  const writer = new ByteWriter(80 + name.length + mime.length + manifest.records.length * 88);
  writer.raw(MAGIC_MANIFEST).u16(manifest.version).u16(manifest.flags).raw(manifest.transferId).u64(manifest.originalSize)
    .u32(manifest.rawBlockSize).u32(manifest.blockCount).u16(name.length).u16(mime.length).raw(manifest.originalFileSha256).raw(new Uint8Array(4)).raw(name).raw(mime);
  for (const record of manifest.records) {
    validHash(record.rawSha256); validHash(record.wireSha256);
    writer.u32(record.generationIndex).u64(record.rawOffset).u32(record.rawLength).u32(record.wireLength)
      .u8(record.compression).raw(new Uint8Array(3)).raw(record.rawSha256).raw(record.wireSha256);
  }
  return writer.finish();
}

export function decodeManifest(bytes: Uint8Array): Manifest {
  assert(bytes.length >= 80, 'manifest too short');
  const reader = new ByteReader(bytes);
  assert(equalBytes(reader.raw(4), MAGIC_MANIFEST), 'invalid manifest magic');
  const version = reader.u16();
  const flags = reader.u16();
  const transferId = reader.raw(16);
  const originalSize = reader.u64();
  const rawBlockSize = reader.u32();
  const blockCount = reader.u32();
  const nameLength = reader.u16();
  const mimeLength = reader.u16();
  const originalFileSha256 = reader.raw(32);
  assert(reader.raw(4).every((value) => value === 0), 'manifest reserved field is non-zero');
  assert(version === 1 && flags === 0, 'unsupported manifest');
  validateLayout(originalSize, rawBlockSize, blockCount);
  assert(nameLength > 0 && nameLength <= 1024 && mimeLength <= 255, 'manifest text length limit');
  const fileName = textDecoder.decode(reader.raw(nameLength));
  const mime = textDecoder.decode(reader.raw(mimeLength));
  const records: ManifestRecord[] = [];
  for (let index = 0; index < blockCount; index += 1) {
    const generationIndex = reader.u32();
    const rawOffset = reader.u64();
    const rawLength = reader.u32();
    const wireLength = reader.u32();
    const compression = reader.u8() as 0 | 1;
    assert(reader.raw(3).every((value) => value === 0), 'manifest record reserved field is non-zero');
    const rawSha256 = reader.raw(32);
    const wireSha256 = reader.raw(32);
    const expectedOffset = BigInt(index) * BigInt(rawBlockSize);
    const expectedLength = index === blockCount - 1 ? Number(originalSize - expectedOffset) : rawBlockSize;
    assert(generationIndex === index && rawOffset === expectedOffset, 'invalid manifest record order');
    assert(rawLength === expectedLength && wireLength > 0 && wireLength <= MAX_DATA_OBJECT_LENGTH, 'invalid manifest record length');
    assert(compression === 0 || compression === 1, 'unsupported compression');
    records.push({ generationIndex, rawOffset, rawLength, wireLength, compression, rawSha256, wireSha256 });
  }
  assert(reader.remaining === 0, 'manifest has trailing bytes');
  assert(records.reduce((sum, record) => sum + BigInt(record.rawLength), 0n) === originalSize, 'manifest size mismatch');
  return { version, flags, transferId, originalSize, rawBlockSize, blockCount, fileName, mime, originalFileSha256, records };
}

export function packetHeaderKey(header: PacketHeader): string {
  return [header.wireVersion, header.kind, Array.from(header.transferId).join(','), header.objectId, header.encodedLength, header.symbolSize, Array.from(header.objectTag).join(',')].join(':');
}

export function encodePacket(header: PacketHeader, symbol: Uint8Array): Uint8Array {
  validTransferId(header.transferId); assert(header.objectTag.length === 16, 'object tag must be 16 bytes');
  assert(header.wireVersion === 1 && header.fecProfile === 1 && header.flags === 0, 'unsupported packet profile');
  assert(header.sourceBlockNumber === 0 && header.encodingSymbolId >= 0 && header.encodingSymbolId <= 0xffffff, 'invalid FEC payload id');
  assert(symbol.length === header.symbolSize, 'symbol size mismatch');
  validatePacketObject(header.kind, header.objectId, header.encodedLength, header.symbolSize);
  const bytes = new Uint8Array(PACKET_HEADER_LENGTH + symbol.length + PACKET_TRAILER_LENGTH);
  bytes.set(MAGIC_PACKET, 0);
  const view = new DataView(bytes.buffer);
  view.setUint8(4, header.wireVersion); view.setUint8(5, header.kind); view.setUint16(6, PACKET_HEADER_LENGTH, true);
  bytes.set(header.transferId, 8); view.setUint32(24, header.objectId, true); view.setUint32(28, header.encodedLength, true);
  view.setUint16(32, header.symbolSize, true); view.setUint8(34, header.fecProfile); view.setUint8(35, header.flags); bytes.set(header.objectTag, 36);
  view.setUint8(52, header.sourceBlockNumber); view.setUint8(53, (header.encodingSymbolId >>> 16) & 0xff); view.setUint8(54, (header.encodingSymbolId >>> 8) & 0xff); view.setUint8(55, header.encodingSymbolId & 0xff);
  view.setUint32(60, crc32c(bytes.slice(0, 60)), true); bytes.set(symbol, 64); view.setUint32(64 + symbol.length, crc32c(bytes.slice(0, 64 + symbol.length)), true);
  return bytes;
}

export function decodePacket(bytes: Uint8Array): ParsedPacket {
  assert(bytes.length >= PACKET_HEADER_LENGTH + PACKET_TRAILER_LENGTH, 'packet too short');
  assert(equalBytes(bytes.slice(0, 4), MAGIC_PACKET), 'invalid packet magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint8(4) === 1 && view.getUint16(6, true) === 64, 'unsupported packet header');
  assert(view.getUint32(60, true) === crc32c(bytes.slice(0, 60)), 'PACKET_CRC_FAILED');
  const symbolSize = view.getUint16(32, true);
  assert(bytes.length === 68 + symbolSize, 'packet length mismatch');
  assert(view.getUint32(64 + symbolSize, true) === crc32c(bytes.slice(0, 64 + symbolSize)), 'PACKET_CRC_FAILED');
  assert(view.getUint8(34) === 1 && view.getUint8(35) === 0 && view.getUint8(52) === 0, 'unsupported packet profile');
  assert(bytes.slice(56, 60).every((value) => value === 0), 'packet reserved bytes are non-zero');
  const encodingSymbolId = (view.getUint8(53) << 16) | (view.getUint8(54) << 8) | view.getUint8(55);
  const header: PacketHeader = {
    wireVersion: view.getUint8(4), kind: view.getUint8(5) as PacketKind, transferId: bytes.slice(8, 24), objectId: view.getUint32(24, true), encodedLength: view.getUint32(28, true), symbolSize, fecProfile: view.getUint8(34), flags: view.getUint8(35), objectTag: bytes.slice(36, 52), sourceBlockNumber: 0, encodingSymbolId,
  };
  validatePacketObject(header.kind, header.objectId, header.encodedLength, header.symbolSize);
  return { header, symbol: bytes.slice(64, 64 + symbolSize) };
}

function validatePacketObject(kind: PacketKind, objectId: number, encodedLength: number, symbolSize: number): void {
  assert(Number.isInteger(objectId) && Number.isInteger(encodedLength) && encodedLength > 0, 'invalid packet object');
  if (kind === 0) {
    assert(objectId === 0 && encodedLength === DESCRIPTOR_LENGTH && symbolSize === CONTROL_SYMBOL_SIZE, 'invalid descriptor packet');
  } else if (kind === 1) {
    assert(objectId === 1 && encodedLength <= MAX_MANIFEST_WIRE_LENGTH && symbolSize === CONTROL_SYMBOL_SIZE, 'invalid manifest packet');
  } else if (kind === 2) {
    assert(objectId >= 2 && objectId < MAX_BLOCKS + 2 && encodedLength <= MAX_DATA_OBJECT_LENGTH, 'invalid data packet');
    assert(DATA_SYMBOL_SIZES.includes(symbolSize as typeof DATA_SYMBOL_SIZES[number]), 'invalid data symbol size');
  } else {
    throw new Error('invalid packet kind');
  }
}

export function raptorPacketPayload(header: PacketHeader, symbol: Uint8Array): Uint8Array {
  const payload = new Uint8Array(4 + symbol.length);
  payload[0] = 0;
  payload[1] = (header.encodingSymbolId >>> 16) & 0xff;
  payload[2] = (header.encodingSymbolId >>> 8) & 0xff;
  payload[3] = header.encodingSymbolId & 0xff;
  payload.set(symbol, 4);
  return payload;
}

export function sha256ObjectTag(bytes: Uint8Array): Uint8Array { return hash(bytes).slice(0, 16); }
export function sha256Object(bytes: Uint8Array): Uint8Array { return hash(bytes); }
