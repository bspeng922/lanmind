import { chooseCompression } from './compression';
import { deriveTransferKey, encryptObject } from './crypto';
import { randomBytes } from './bytes';
import { hash, hashHex } from './hash';
import { Sha256Stream } from './hash';
import { createOpticalObjectStore, type OpticalObjectStore } from '../storage/objectStore';
import { encodeDescriptor, encodeManifest } from './protocol';
import {
  MAX_BLOCKS,
  MAX_FILE_SIZE,
  PBKDF2_ITERATIONS,
  type Descriptor,
  type Manifest,
  type PreparedBlock,
  type PreparedTransfer,
} from './types';
import { objectIdForGeneration } from './types';

export interface PrepareOptions {
  blockSize?: number;
  dataSymbolSize?: number;
  password?: string;
  fileName?: string;
  mime?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  /** Use persistent block objects for large transfers instead of retaining wire bytes. */
  objectStore?: OpticalObjectStore;
  persistLargeFiles?: boolean;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function safeName(name: string): string {
  const normalized = name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '_').trim();
  return normalized && normalized !== '.' && normalized !== '..' ? normalized.slice(0, 255) : 'received-file';
}

function createDescriptor(fileSize: number, blockSize: number, dataSymbolSize: number, encrypted: boolean): Descriptor {
  const blockCount = fileSize === 0 ? 0 : Math.ceil(fileSize / blockSize);
  if (blockCount > MAX_BLOCKS) throw new Error('MAX_BLOCKS exceeded');
  return {
    version: 1,
    cryptoSuite: encrypted ? 1 : 0,
    kdf: encrypted ? 1 : 0,
    transferId: randomBytes(16),
    salt: encrypted ? randomBytes(16) : new Uint8Array(16),
    iterations: encrypted ? PBKDF2_ITERATIONS : 0,
    noncePrefix: encrypted ? randomBytes(8) : new Uint8Array(8),
    rawBlockSize: blockSize,
    blockCount,
    originalSize: BigInt(fileSize),
    manifestWireLength: 0,
    manifestWireSha256: new Uint8Array(32),
    dataSymbolSize,
    controlSymbolSize: 256,
    flags: 0,
  };
}

export async function prepareTransfer(file: Blob, options: PrepareOptions = {}): Promise<PreparedTransfer> {
  if (file.size > MAX_FILE_SIZE) throw new Error('FILE_SIZE_LIMIT');
  const blockSize = options.blockSize ?? 1024 * 1024;
  const dataSymbolSize = options.dataSymbolSize ?? 960;
  if (![256 * 1024, 512 * 1024, 1024 * 1024, 2 * 1024 * 1024, 4 * 1024 * 1024].includes(blockSize)) throw new Error('invalid block size');
  const descriptor = createDescriptor(file.size, blockSize, dataSymbolSize, Boolean(options.password));
  const descriptorBytesForContext = encodeDescriptor(descriptor);
  const key = options.password ? await deriveTransferKey(options.password, descriptor) : undefined;
  const objectStore = options.objectStore ?? (options.persistLargeFiles !== false && file.size > 32 * 1024 * 1024 ? await createOpticalObjectStore() : undefined);
  const objectPrefix = `transfer/${Array.from(descriptor.transferId, (value) => value.toString(16).padStart(2, '0')).join('')}/`;
  const blocks: PreparedBlock[] = [];
  const fullSha = new Sha256Stream();
  const records = [];
  for (let index = 0; index < descriptor.blockCount; index += 1) {
    checkAbort(options.signal);
    const offset = index * blockSize;
    const raw = new Uint8Array(await file.slice(offset, Math.min(offset + blockSize, file.size)).arrayBuffer());
    fullSha.update(raw);
    const rawSha256 = hash(raw);
    const chosen = await chooseCompression(raw);
    const wire = key
      ? await encryptObject(key, descriptor, descriptorBytesForContext, 2, objectIdForGeneration(index), BigInt(offset), raw.length, chosen.compression, chosen.bytes)
      : chosen.bytes;
    const wireSha256 = hash(wire);
    const objectId = objectIdForGeneration(index);
    if (objectStore) await objectStore.put(`${objectPrefix}${objectId}`, wire);
    blocks.push({ objectId, rawOffset: BigInt(offset), rawLength: raw.length, compression: chosen.compression, rawSha256, wire: objectStore ? new Uint8Array(0) : wire, wireSha256 });
    records.push({ generationIndex: index, rawOffset: BigInt(offset), rawLength: raw.length, wireLength: wire.length, compression: chosen.compression, rawSha256, wireSha256 });
    options.onProgress?.(index + 1, Math.max(1, descriptor.blockCount));
  }
  const fullFileSha = fullSha.digest();
  const manifest: Manifest = {
    version: 1,
    flags: 0,
    transferId: descriptor.transferId.slice(),
    originalSize: descriptor.originalSize,
    rawBlockSize: descriptor.rawBlockSize,
    blockCount: descriptor.blockCount,
    fileName: safeName(options.fileName ?? ((typeof File !== 'undefined' && file instanceof File) ? file.name : 'received-file')),
    mime: (options.mime || file.type || 'application/octet-stream').slice(0, 255),
    originalFileSha256: fullFileSha,
    records,
  };
  const manifestPlainBytes = encodeManifest(manifest);
  const manifestWireLength = descriptor.cryptoSuite ? manifestPlainBytes.length + 16 : manifestPlainBytes.length;
  const finalDescriptor: Descriptor = { ...descriptor, manifestWireLength, manifestWireSha256: new Uint8Array(32) };
  const finalDescriptorBytes = encodeDescriptor(finalDescriptor);
  const manifestWire = key
    ? await encryptObject(key, finalDescriptor, finalDescriptorBytes, 1, 1, 0n, manifestPlainBytes.length, 0, manifestPlainBytes)
    : manifestPlainBytes;
  finalDescriptor.manifestWireSha256 = hash(manifestWire);
  const descriptorBytes = encodeDescriptor(finalDescriptor);
  return {
    descriptor: finalDescriptor,
    descriptorBytes,
    manifest,
    manifestPlainBytes,
    manifestWire,
    blocks,
    key,
    objectStore,
    loadBlock: async (block) => {
      if (!objectStore || block.wire.length > 0) return block.wire;
      const value = await objectStore.get(`${objectPrefix}${block.objectId}`);
      if (!value) throw new Error('TRANSFER_OBJECT_MISSING');
      return value;
    },
  };
}

export function transferSummary(transfer: PreparedTransfer): { id: string; fileName: string; bytes: number; blocks: number; encrypted: boolean; hash: string } {
  return { id: Array.from(transfer.descriptor.transferId, (x) => x.toString(16).padStart(2, '0')).join(''), fileName: transfer.manifest.fileName, bytes: Number(transfer.descriptor.originalSize), blocks: transfer.blocks.length, encrypted: transfer.descriptor.cryptoSuite === 1, hash: hashHex(transfer.manifest.originalFileSha256) };
}
