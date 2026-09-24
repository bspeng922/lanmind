import { zstdDecompress } from './compression';
import { decryptObject, deriveTransferKey } from './crypto';
import { equalBytes, hex, textDecoder, textEncoder } from './bytes';
import { hash, Sha256Stream } from './hash';
import { decodeDescriptor, decodeManifest, decodePacket, packetHeaderKey } from './protocol';
import { FecObjectDecoder } from './fec';
import type { Descriptor, Manifest, PacketHeader, PreparedBlock } from './types';
import { generationForObjectId } from './types';
import type { OpticalObjectStore } from '../storage/objectStore';

interface ObjectState {
  header: PacketHeader;
  decoder: FecObjectDecoder;
  received: Set<number>;
  bytes?: Uint8Array;
  processing?: Promise<void>;
}

export interface ReceiverProgress {
  transferId?: string;
  descriptor: boolean;
  manifest: boolean;
  blocks: number;
  totalBlocks: number;
  verifiedBytes: number;
  totalBytes: number;
  complete: boolean;
  needsPassword: boolean;
  fileName?: string;
}

export interface OpticalCheckpoint {
  version: 1;
  descriptor: string;
  manifestWire?: string;
  blocks: Array<{ index: number; raw: string }>;
}

function base64(bytes: Uint8Array): string {
  let value = '';
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class OpticalReceiverSession {
  constructor(private readonly objectStore?: OpticalObjectStore) {}
  private descriptor?: Descriptor;
  private descriptorBytes?: Uint8Array;
  private manifest?: Manifest;
  private key?: CryptoKey;
  private password?: string;
  private readonly objects = new Map<string, ObjectState>();
  private readonly blocks = new Map<number, PreparedBlock>();
  // Raw blocks are kept independently from their wire/FEC buffers. Once an
  // object is verified, the wire buffer can be released before the final file
  // is built. A persistent store can replace this map without changing the
  // protocol state machine.
  private readonly blockRaw = new Map<number, Uint8Array>();
  private queue = Promise.resolve();
  private error?: Error;

  async pushPacketBytes(packetBytes: Uint8Array): Promise<ReceiverProgress> {
    this.queue = this.queue.then(() => this.pushPacketInternal(packetBytes)).catch((error) => {
      this.error = error instanceof Error ? error : new Error(String(error));
    });
    await this.queue;
    if (this.error) throw this.error;
    return this.progress();
  }

  async setPassword(password: string): Promise<ReceiverProgress> {
    if (!this.descriptor || this.descriptor.cryptoSuite !== 1) return this.progress();
    this.password = password;
    this.key = await deriveTransferKey(password, this.descriptor);
    for (const state of this.objects.values()) if (state.bytes && state.header.kind === 1) await this.processManifest(state);
    return this.progress();
  }

  getProgress(): ReceiverProgress { return this.progress(); }
  getFileName(): string | undefined { return this.manifest?.fileName; }

  exportCheckpoint(): Uint8Array {
    const descriptor = this.descriptorBytes;
    if (!descriptor) throw new Error('CHECKPOINT_NOT_READY');
    const manifestState = Array.from(this.objects.values()).find((state) => state.header.kind === 1 && state.bytes);
    const checkpoint: OpticalCheckpoint = {
      version: 1,
      descriptor: base64(descriptor),
      manifestWire: manifestState?.bytes ? base64(manifestState.bytes) : undefined,
      blocks: Array.from(this.blockRaw, ([index, raw]) => ({ index, raw: base64(raw) })),
    };
    return textEncoder.encode(JSON.stringify(checkpoint));
  }

  async importCheckpoint(bytes: Uint8Array, password?: string): Promise<ReceiverProgress> {
    const checkpoint = JSON.parse(textDecoder.decode(bytes)) as OpticalCheckpoint;
    if (checkpoint.version !== 1 || !checkpoint.descriptor) throw new Error('ARCHIVE_CORRUPT');
    const descriptorBytes = fromBase64(checkpoint.descriptor);
    this.descriptor = decodeDescriptor(descriptorBytes);
    this.descriptorBytes = descriptorBytes;
    this.password = password;
    if (this.descriptor.cryptoSuite === 1 && password) this.key = await deriveTransferKey(password, this.descriptor);
    if (checkpoint.manifestWire) {
      const manifestWire = fromBase64(checkpoint.manifestWire);
      if (!equalBytes(hash(manifestWire), this.descriptor.manifestWireSha256)) throw new Error('OBJECT_HASH_FAILED');
      const state = { header: { wireVersion: 1, kind: 1 as const, transferId: this.descriptor.transferId, objectId: 1, encodedLength: manifestWire.length, symbolSize: this.descriptor.controlSymbolSize, fecProfile: 1, flags: 0, objectTag: new Uint8Array(16), sourceBlockNumber: 0, encodingSymbolId: 0 }, decoder: undefined as never, received: new Set<number>(), bytes: manifestWire };
      this.objects.set('checkpoint-manifest', state);
      if (this.descriptor.cryptoSuite === 0) this.manifest = decodeManifest(manifestWire);
      else if (this.key) this.manifest = decodeManifest(await decryptObject(this.key, this.descriptor, descriptorBytes, 1, 1, 0n, manifestWire.length - 16, 0, manifestWire));
    }
    if (this.manifest) {
      for (const item of checkpoint.blocks) {
        const record = this.manifest.records[item.index];
        if (!record) continue;
        const raw = fromBase64(item.raw);
        if (raw.length !== record.rawLength || !equalBytes(hash(raw), record.rawSha256)) throw new Error('RAW_HASH_FAILED');
        const block: PreparedBlock = { objectId: item.index + 2, rawOffset: record.rawOffset, rawLength: record.rawLength, compression: record.compression, rawSha256: record.rawSha256, wire: new Uint8Array(0), wireSha256: record.wireSha256 };
        this.blocks.set(item.index, block); this.blockRaw.set(item.index, raw);
        if (this.objectStore) await this.objectStore.put(this.blockStoreKey(item.index), raw);
      }
    }
    return this.progress();
  }

  async buildFile(): Promise<{ blob: Blob; name: string; mime: string; sha256: string }> {
    if (!this.manifest || this.blocks.size !== this.manifest.blockCount) throw new Error('NEED_MORE_DATA');
    const parts: Uint8Array[] = [];
    const stream = new Sha256Stream();
    for (let index = 0; index < this.manifest.blockCount; index += 1) {
      const block = this.blocks.get(index);
      if (!block) throw new Error('NEED_MORE_DATA');
      const raw = this.blockRaw.get(index) ?? (this.objectStore ? await this.objectStore.get(this.blockStoreKey(index)) : undefined);
      if (!raw) throw new Error('NEED_MORE_DATA');
      stream.update(raw);
      parts.push(raw);
    }
    const fullHash = stream.digest();
    if (!equalBytes(fullHash, this.manifest.originalFileSha256)) throw new Error('FILE_HASH_FAILED');
    return { blob: new Blob(parts, { type: this.manifest.mime }), name: this.manifest.fileName, mime: this.manifest.mime, sha256: hex(fullHash) };
  }

  async writeFile(writable: { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }): Promise<{ name: string; mime: string; sha256: string }> {
    if (!this.manifest || this.blocks.size !== this.manifest.blockCount) throw new Error('NEED_MORE_DATA');
    const stream = new Sha256Stream();
    try {
      for (let index = 0; index < this.manifest.blockCount; index += 1) {
        const block = this.blocks.get(index);
        if (!block) throw new Error('NEED_MORE_DATA');
        const raw = this.blockRaw.get(index) ?? (this.objectStore ? await this.objectStore.get(this.blockStoreKey(index)) : undefined);
        if (!raw) throw new Error('NEED_MORE_DATA');
        stream.update(raw);
        await writable.write(raw);
      }
      const fullHash = stream.digest();
      if (!equalBytes(fullHash, this.manifest.originalFileSha256)) throw new Error('FILE_HASH_FAILED');
      await writable.close();
      return { name: this.manifest.fileName, mime: this.manifest.mime, sha256: hex(fullHash) };
    } catch (error) {
      await writable.abort?.();
      throw error;
    }
  }

  private async pushPacketInternal(packetBytes: Uint8Array): Promise<void> {
    const parsed = decodePacket(packetBytes);
    const key = packetHeaderKey(parsed.header);
    let state = this.objects.get(key);
    if (!state) {
      state = { header: parsed.header, decoder: new FecObjectDecoder(parsed.header.encodedLength, parsed.header.symbolSize), received: new Set() };
      this.objects.set(key, state);
    }
    if (state.received.has(parsed.header.encodingSymbolId)) return;
    state.received.add(parsed.header.encodingSymbolId);
    const result = await state.decoder.push(parsed.header.encodingSymbolId, parsed.symbol);
    if (!result || state.bytes) return;
    if (!equalBytes(hash(result).slice(0, 16), parsed.header.objectTag)) throw new Error('OBJECT_HASH_FAILED');
    state.bytes = result;
    if (parsed.header.kind === 0 && parsed.header.objectId === 0) await this.processDescriptor(state);
    else if (parsed.header.kind === 1 && parsed.header.objectId === 1) await this.processManifest(state);
    else if (parsed.header.kind === 2) await this.processData(state);
  }

  private async processDescriptor(state: ObjectState): Promise<void> {
    if (this.descriptor) {
      if (!equalBytes(this.descriptor.transferId, state.header.transferId)) throw new Error('OBJECT_CONFLICT');
      return;
    }
    const descriptor = decodeDescriptor(state.bytes!);
    if (!equalBytes(descriptor.transferId, state.header.transferId)) throw new Error('OBJECT_CONFLICT');
    this.descriptor = descriptor;
    this.descriptorBytes = state.bytes!.slice();
    if (descriptor.cryptoSuite === 1 && this.password) this.key = await deriveTransferKey(this.password, descriptor);
    for (const object of this.objects.values()) {
      if (object.bytes && object.header.kind === 1) await this.processManifest(object);
      if (object.bytes && object.header.kind === 2) await this.processData(object);
    }
  }

  private async processManifest(state: ObjectState): Promise<void> {
    if (!this.descriptor || !state.bytes || this.manifest) return;
    if (this.descriptor.cryptoSuite === 1 && !this.key) return;
    const plain = this.descriptor.cryptoSuite === 1
      ? await decryptObject(this.key!, this.descriptor, this.descriptorBytes!, 1, 1, 0n, state.bytes.length - 16, 0, state.bytes)
      : state.bytes;
    const manifest = decodeManifest(plain);
    if (!equalBytes(manifest.transferId, this.descriptor.transferId) || manifest.blockCount !== this.descriptor.blockCount || manifest.originalSize !== this.descriptor.originalSize) throw new Error('INCOMPATIBLE_SESSION');
    if (!equalBytes(hash(state.bytes), this.descriptor.manifestWireSha256)) throw new Error('OBJECT_HASH_FAILED');
    this.manifest = manifest;
    for (const object of this.objects.values()) if (object.bytes && object.header.kind === 2) await this.processData(object);
  }

  private async processData(state: ObjectState): Promise<void> {
    if (!this.descriptor || !this.manifest || !state.bytes || state.header.objectId < 2) return;
    const index = generationForObjectId(state.header.objectId);
    const record = this.manifest.records[index];
    if (!record || state.bytes.length !== record.wireLength || !equalBytes(hash(state.bytes), record.wireSha256)) throw new Error('OBJECT_HASH_FAILED');
    const block: PreparedBlock = { objectId: state.header.objectId, rawOffset: record.rawOffset, rawLength: record.rawLength, compression: record.compression, rawSha256: record.rawSha256, wire: state.bytes, wireSha256: record.wireSha256 };
    const raw = await this.materializeBlock(block);
    this.blocks.set(index, block);
    this.blockRaw.set(index, raw);
    if (this.objectStore) await this.objectStore.put(this.blockStoreKey(index), raw);
    // Do not retain both the encoded object and the verified raw block.
    state.bytes = undefined;
    block.wire = new Uint8Array(0);
    state.decoder.dispose();
  }

  private async materializeBlock(block: PreparedBlock): Promise<Uint8Array> {
    const descriptor = this.descriptor!;
    let packed = block.wire;
    if (descriptor.cryptoSuite === 1) packed = await decryptObject(this.key!, descriptor, this.descriptorBytes!, 2, block.objectId, block.rawOffset, block.rawLength, block.compression, packed);
    const raw = block.compression === 1 ? await zstdDecompress(packed, block.rawLength) : packed;
    if (raw.length !== block.rawLength || !equalBytes(hash(raw), block.rawSha256)) throw new Error('RAW_HASH_FAILED');
    return raw;
  }

  private progress(): ReceiverProgress {
    const totalBlocks = this.descriptor?.blockCount ?? 0;
    const totalBytes = Number(this.descriptor?.originalSize ?? 0n);
    const verifiedBytes = Array.from(this.blocks.values()).reduce((sum, block) => sum + block.rawLength, 0);
    return { transferId: this.descriptor ? hex(this.descriptor.transferId) : undefined, descriptor: Boolean(this.descriptor), manifest: Boolean(this.manifest), blocks: this.blocks.size, totalBlocks, verifiedBytes, totalBytes, complete: Boolean(this.manifest && this.blocks.size === totalBlocks), needsPassword: Boolean(this.descriptor?.cryptoSuite === 1 && !this.key), fileName: this.manifest?.fileName };
  }

  private blockStoreKey(index: number): string {
    return `optical/${this.descriptor ? hex(this.descriptor.transferId) : 'unknown'}/block-${index}`;
  }
}
