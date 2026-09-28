import { equalBytes, hex } from './bytes';
import { zstdDecompress } from './compression';
import { decryptObject, deriveTransferKey } from './crypto';
import { OpticalTransferError, opticalError } from './errors';
import { FecObjectDecoder } from './fec';
import { hash, Sha256Stream } from './hash';
import { decodeDescriptor, decodeManifest, decodePacket, packetHeaderKey } from './protocol';
import { generationForObjectId } from './types';
import type { Descriptor, Manifest, ManifestRecord, PacketHeader } from './types';
import type { OpticalObjectStore } from '../storage/objectStore';
import { OpticalSessionStore, type OpticalSessionMetadata } from '../storage/sessionStore';

const MAX_ACTIVE_OBJECTS = 64;
const MAX_CANDIDATE_TRANSFERS = 4;
const MAX_BLOB_OUTPUT = 64 * 1024 * 1024;

interface ObjectState {
  identity: string;
  headerKey: string;
  header: PacketHeader;
  decoder: FecObjectDecoder;
  bytes?: Uint8Array;
}

export type ReceiverStatus =
  | 'waiting-control'
  | 'waiting-password'
  | 'receiving'
  | 'verifying'
  | 'verified'
  | 'saving'
  | 'saved'
  | 'recoverable-error'
  | 'paused';

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
  status: ReceiverStatus;
  persistent: boolean;
  lastError?: string;
}

function objectIdentity(header: PacketHeader): string {
  return `${header.kind}:${header.objectId}`;
}

function descriptorMatchesManifest(descriptor: Descriptor, manifest: Manifest): boolean {
  return equalBytes(manifest.transferId, descriptor.transferId)
    && manifest.blockCount === descriptor.blockCount
    && manifest.originalSize === descriptor.originalSize
    && manifest.rawBlockSize === descriptor.rawBlockSize;
}

export class OpticalReceiverSession {
  private readonly sessions?: OpticalSessionStore;
  private metadata?: OpticalSessionMetadata;
  private descriptor?: Descriptor;
  private descriptorBytes?: Uint8Array;
  private manifest?: Manifest;
  private manifestWire?: Uint8Array;
  private key?: CryptoKey;
  private pendingPassword?: string;
  private readonly objects = new Map<string, ObjectState>();
  private readonly objectHeaders = new Map<string, string>();
  private readonly completedObjects = new Set<string>();
  private readonly candidateTransfers = new Set<string>();
  private readonly blocks = new Map<number, ManifestRecord>();
  private readonly blockWire = new Map<number, Uint8Array>();
  private queue = Promise.resolve();
  private status: ReceiverStatus = 'waiting-control';
  private lastError?: string;
  private fileVerified = false;

  constructor(private readonly objectStore?: OpticalObjectStore) {
    this.sessions = objectStore ? new OpticalSessionStore(objectStore) : undefined;
  }

  async pushPacketBytes(packetBytes: Uint8Array): Promise<ReceiverProgress> {
    const operation = this.queue.then(() => this.pushPacketInternal(packetBytes));
    this.queue = operation.catch(() => undefined);
    try {
      await operation;
      this.lastError = undefined;
    } catch (cause) {
      const error = opticalError(cause, 'OBJECT_HASH_FAILED');
      this.lastError = error.code;
      this.status = 'recoverable-error';
      throw error;
    }
    return this.progress();
  }

  async setPassword(password: string): Promise<ReceiverProgress> {
    const operation = this.queue.then(async () => {
      this.pendingPassword = password;
      if (!this.descriptor || this.descriptor.cryptoSuite !== 1 || !this.manifestWire) return;
      await this.authenticatePassword(password);
    });
    this.queue = operation.catch(() => undefined);
    try {
      await operation;
      this.lastError = undefined;
      if (this.status === 'recoverable-error') this.status = this.descriptor?.cryptoSuite === 1 && !this.key ? 'waiting-password' : this.manifest ? 'receiving' : 'waiting-control';
    } catch (cause) {
      const error = opticalError(cause, 'AUTH_FAILED');
      this.lastError = error.code;
      this.status = 'waiting-password';
      throw error;
    }
    return this.progress();
  }

  async restoreLatest(password?: string): Promise<ReceiverProgress> {
    if (!this.sessions) throw new OpticalTransferError('SESSION_NOT_FOUND');
    const metadata = await this.sessions.latest();
    if (!metadata) throw new OpticalTransferError('SESSION_NOT_FOUND');
    return this.restore(metadata, password);
  }

  async abandon(): Promise<void> {
    await this.drain();
    if (this.metadata && this.sessions) await this.sessions.delete(this.metadata.sessionId);
    this.reset();
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  dispose(): void {
    for (const state of this.objects.values()) state.decoder.dispose();
    this.objects.clear();
    this.status = 'paused';
  }

  getProgress(): ReceiverProgress { return this.progress(); }
  getFileName(): string | undefined { return this.manifest?.fileName; }

  async buildFile(): Promise<{ blob: Blob; name: string; mime: string; sha256: string }> {
    if (!this.manifest || !this.fileVerified) throw new OpticalTransferError('NEED_MORE_DATA');
    if (this.manifest.originalSize > BigInt(MAX_BLOB_OUTPUT)) throw new Error('OUTPUT_REQUIRES_STREAM');
    const parts: Uint8Array[] = [];
    const result = await this.readVerifiedBlocks(async (raw) => { parts.push(raw); });
    return { blob: new Blob(parts, { type: this.manifest.mime }), name: this.manifest.fileName, mime: this.manifest.mime, sha256: result };
  }

  async writeFile(writable: { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }): Promise<{ name: string; mime: string; sha256: string }> {
    if (!this.manifest || !this.fileVerified) throw new OpticalTransferError('NEED_MORE_DATA');
    this.status = 'saving';
    try {
      const sha256 = await this.readVerifiedBlocks((raw) => writable.write(raw));
      await writable.close();
      this.status = 'saved';
      return { name: this.manifest.fileName, mime: this.manifest.mime, sha256 };
    } catch (error) {
      try { await writable.abort?.(); } catch { /* preserve the original failure */ }
      this.status = 'verified';
      throw error;
    }
  }

  private async restore(metadata: OpticalSessionMetadata, password?: string): Promise<ReceiverProgress> {
    this.reset();
    const descriptorBytes = await this.sessions!.readDescriptor(metadata.sessionId);
    if (!descriptorBytes || hashHex(descriptorBytes) !== metadata.descriptorHash) throw new OpticalTransferError('OBJECT_HASH_FAILED');
    const descriptor = decodeDescriptor(descriptorBytes);
    if (hex(descriptor.transferId) !== metadata.transferId) throw new OpticalTransferError('INCOMPATIBLE_SESSION');
    this.metadata = metadata;
    this.descriptor = descriptor;
    this.descriptorBytes = descriptorBytes;
    this.candidateTransfers.add(metadata.transferId);
    this.completedObjects.add('0:0');
    this.objectHeaders.set('0:0', 'restored');
    const manifestWire = await this.sessions!.readManifest(metadata.sessionId);
    if (manifestWire) {
      this.validateManifestWire(manifestWire);
      this.manifestWire = manifestWire;
      this.completedObjects.add('1:1');
      if (descriptor.cryptoSuite === 0) this.manifest = await this.decodeManifestWire(manifestWire);
      else if (password) {
        const candidate = await deriveTransferKey(password, descriptor);
        this.manifest = await this.decodeManifestWire(manifestWire, candidate);
        this.key = candidate;
      }
    }
    this.status = descriptor.cryptoSuite === 1 && !this.key ? 'waiting-password' : 'receiving';
    if (this.manifest) {
      await this.hydrateCommittedBlocks();
      await this.verifyIfComplete();
    }
    return this.progress();
  }

  private async pushPacketInternal(packetBytes: Uint8Array): Promise<void> {
    const parsed = decodePacket(packetBytes);
    const transferId = hex(parsed.header.transferId);
    if (this.descriptor && !equalBytes(parsed.header.transferId, this.descriptor.transferId)) throw new OpticalTransferError('INCOMPATIBLE_SESSION');
    if (!this.descriptor && !this.candidateTransfers.has(transferId)) {
      if (this.candidateTransfers.size >= MAX_CANDIDATE_TRANSFERS) throw new OpticalTransferError('RECEIVER_RESOURCE_LIMIT');
      this.candidateTransfers.add(transferId);
    }
    this.validateHeaderAgainstControl(parsed.header);
    const identity = objectIdentity(parsed.header);
    const headerKey = packetHeaderKey(parsed.header);
    const knownHeader = this.objectHeaders.get(identity);
    if (knownHeader && knownHeader !== headerKey && knownHeader !== 'restored') throw new OpticalTransferError('OBJECT_CONFLICT');
    if (this.completedObjects.has(identity)) return;
    this.objectHeaders.set(identity, headerKey);

    let state = this.objects.get(identity);
    if (!state) {
      this.ensureObjectBudget(parsed.header.kind);
      state = {
        identity,
        headerKey,
        header: parsed.header,
        decoder: new FecObjectDecoder(parsed.header.encodedLength, parsed.header.symbolSize),
      };
      this.objects.set(identity, state);
    }
    if (state.bytes) {
      await this.processCompletedObject(state);
      return;
    }
    const result = await state.decoder.push(parsed.header.encodingSymbolId, parsed.symbol);
    if (!result) return;
    if (!equalBytes(hash(result).slice(0, 16), parsed.header.objectTag)) throw new OpticalTransferError('OBJECT_HASH_FAILED');
    state.bytes = result;
    await this.processCompletedObject(state);
  }

  private async processCompletedObject(state: ObjectState): Promise<void> {
    if (state.header.kind === 0) await this.processDescriptor(state);
    else if (state.header.kind === 1) await this.processManifest(state);
    else await this.processData(state);
  }

  private finishObject(state: ObjectState): void {
    state.decoder.dispose();
    state.bytes = undefined;
    this.objects.delete(state.identity);
    this.completedObjects.add(state.identity);
  }

  private async processDescriptor(state: ObjectState): Promise<void> {
    const bytes = state.bytes!;
    const descriptor = decodeDescriptor(bytes);
    if (!equalBytes(descriptor.transferId, state.header.transferId)) throw new OpticalTransferError('OBJECT_CONFLICT');
    if (this.descriptorBytes && !equalBytes(this.descriptorBytes, bytes)) throw new OpticalTransferError('OBJECT_CONFLICT');
    if (!this.descriptor) {
      const metadata = this.sessions ? await this.sessions.create(bytes, hex(descriptor.transferId), descriptor.cryptoSuite === 1) : undefined;
      this.descriptor = descriptor;
      this.descriptorBytes = bytes.slice();
      this.metadata = metadata;
      this.status = descriptor.cryptoSuite === 1 ? 'waiting-password' : 'receiving';
      this.dropOtherTransfers();
    }
    this.finishObject(state);
    for (const object of Array.from(this.objects.values())) {
      if (object.bytes && object.header.kind === 1) await this.processManifest(object);
    }
  }

  private async processManifest(state: ObjectState): Promise<void> {
    if (!this.descriptor || !state.bytes) return;
    this.validateManifestWire(state.bytes);
    this.manifestWire = state.bytes.slice();
    if (this.metadata && this.sessions) await this.sessions.commitManifest(this.metadata, state.bytes);
    if (this.descriptor.cryptoSuite === 0) {
      this.manifest = await this.decodeManifestWire(state.bytes);
      this.status = 'receiving';
    }
    this.finishObject(state);
    if (this.descriptor.cryptoSuite === 1 && this.pendingPassword) await this.authenticatePassword(this.pendingPassword);
    if (this.manifest) {
      await this.hydrateCommittedBlocks();
      await this.processCompletedDataObjects();
      await this.verifyIfComplete();
    }
  }

  private async processCompletedDataObjects(): Promise<void> {
    for (const object of Array.from(this.objects.values())) {
      if (object.bytes && object.header.kind === 2) await this.processData(object);
    }
  }

  private async processData(state: ObjectState): Promise<void> {
    if (!this.descriptor || !this.manifest || !state.bytes || state.header.objectId < 2) return;
    const index = generationForObjectId(state.header.objectId);
    if (this.blocks.has(index)) {
      this.finishObject(state);
      return;
    }
    const record = this.manifest.records[index];
    if (!record || state.bytes.length !== record.wireLength || !equalBytes(hash(state.bytes), record.wireSha256)) throw new OpticalTransferError('OBJECT_HASH_FAILED');
    await this.materializeBlock(index, state.bytes);
    // Progress is committed only after the verified wire object is durable.
    if (this.metadata && this.sessions) await this.sessions.commitBlock(this.metadata, index, state.bytes);
    else this.blockWire.set(index, state.bytes.slice());
    this.blocks.set(index, record);
    this.finishObject(state);
    await this.verifyIfComplete();
  }

  private async authenticatePassword(password: string): Promise<void> {
    if (!this.descriptor || this.descriptor.cryptoSuite !== 1 || !this.manifestWire) return;
    const candidate = await deriveTransferKey(password, this.descriptor);
    const manifest = await this.decodeManifestWire(this.manifestWire, candidate);
    // Only authenticated manifest bytes may commit the candidate key.
    this.key = candidate;
    this.manifest = manifest;
    this.status = 'receiving';
    await this.hydrateCommittedBlocks();
    await this.processCompletedDataObjects();
    await this.verifyIfComplete();
  }

  private async hydrateCommittedBlocks(): Promise<void> {
    if (!this.metadata || !this.sessions || !this.manifest) return;
    for (const index of this.metadata.committedBlocks) {
      if (this.blocks.has(index)) continue;
      const record = this.manifest.records[index];
      const wire = record ? await this.sessions.readBlock(this.metadata.sessionId, index) : undefined;
      if (!record || !wire || wire.length !== record.wireLength || !equalBytes(hash(wire), record.wireSha256)) throw new OpticalTransferError('OBJECT_HASH_FAILED');
      await this.materializeBlock(index, wire);
      this.blocks.set(index, record);
      this.completedObjects.add(`2:${index + 2}`);
    }
  }

  private async materializeBlock(index: number, wire: Uint8Array): Promise<Uint8Array> {
    const descriptor = this.descriptor!;
    const record = this.manifest!.records[index];
    let packed = wire;
    if (descriptor.cryptoSuite === 1) {
      if (!this.key) throw new OpticalTransferError('AUTH_FAILED');
      packed = await decryptObject(this.key, descriptor, this.descriptorBytes!, 2, index + 2, record.rawOffset, record.rawLength, record.compression, wire);
    }
    const raw = record.compression === 1 ? await zstdDecompress(packed, record.rawLength) : packed;
    if (raw.length !== record.rawLength || !equalBytes(hash(raw), record.rawSha256)) throw new OpticalTransferError('RAW_HASH_FAILED');
    return raw;
  }

  private async readWire(index: number): Promise<Uint8Array> {
    const wire = this.metadata && this.sessions
      ? await this.sessions.readBlock(this.metadata.sessionId, index)
      : this.blockWire.get(index);
    if (!wire) throw new OpticalTransferError('NEED_MORE_DATA');
    return wire;
  }

  private async readVerifiedBlocks(consume: (raw: Uint8Array) => Promise<void> | void): Promise<string> {
    if (!this.manifest || this.blocks.size !== this.manifest.blockCount) throw new OpticalTransferError('NEED_MORE_DATA');
    const stream = new Sha256Stream();
    for (let index = 0; index < this.manifest.blockCount; index += 1) {
      const raw = await this.materializeBlock(index, await this.readWire(index));
      stream.update(raw);
      await consume(raw);
    }
    const digest = stream.digest();
    if (!equalBytes(digest, this.manifest.originalFileSha256)) throw new OpticalTransferError('FILE_HASH_FAILED');
    return hex(digest);
  }

  private async verifyIfComplete(): Promise<void> {
    if (!this.manifest || this.blocks.size !== this.manifest.blockCount || this.fileVerified) return;
    this.status = 'verifying';
    await this.readVerifiedBlocks(() => undefined);
    this.fileVerified = true;
    this.status = 'verified';
  }

  private validateManifestWire(wire: Uint8Array): void {
    if (!this.descriptor || wire.length !== this.descriptor.manifestWireLength || !equalBytes(hash(wire), this.descriptor.manifestWireSha256)) {
      throw new OpticalTransferError('OBJECT_HASH_FAILED');
    }
  }

  private async decodeManifestWire(wire: Uint8Array, key?: CryptoKey): Promise<Manifest> {
    this.validateManifestWire(wire);
    const plain = this.descriptor!.cryptoSuite === 1
      ? await decryptObject(key!, this.descriptor!, this.descriptorBytes!, 1, 1, 0n, wire.length - 16, 0, wire)
      : wire;
    const manifest = decodeManifest(plain);
    if (!descriptorMatchesManifest(this.descriptor!, manifest)) throw new OpticalTransferError('INCOMPATIBLE_SESSION');
    return manifest;
  }

  private validateHeaderAgainstControl(header: PacketHeader): void {
    if (this.descriptor && header.kind === 1) {
      if (header.encodedLength !== this.descriptor.manifestWireLength || header.symbolSize !== this.descriptor.controlSymbolSize || !equalBytes(header.objectTag, this.descriptor.manifestWireSha256.slice(0, 16))) {
        throw new OpticalTransferError('OBJECT_CONFLICT');
      }
    }
    if (this.manifest && header.kind === 2) {
      const index = header.objectId - 2;
      const record = this.manifest.records[index];
      if (!record || header.encodedLength !== record.wireLength || header.symbolSize !== this.descriptor!.dataSymbolSize || !equalBytes(header.objectTag, record.wireSha256.slice(0, 16))) {
        throw new OpticalTransferError('OBJECT_CONFLICT');
      }
    }
  }

  private ensureObjectBudget(kind: number): void {
    if (this.objects.size < MAX_ACTIVE_OBJECTS) return;
    if (kind < 2) {
      const entry = Array.from(this.objects.entries()).find(([, state]) => state.header.kind === 2);
      if (entry) {
        entry[1].decoder.dispose();
        this.objects.delete(entry[0]);
        this.objectHeaders.delete(entry[0]);
        return;
      }
    }
    throw new OpticalTransferError('RECEIVER_RESOURCE_LIMIT');
  }

  private dropOtherTransfers(): void {
    for (const [identity, state] of this.objects) {
      if (!equalBytes(state.header.transferId, this.descriptor!.transferId)) {
        state.decoder.dispose();
        this.objects.delete(identity);
        this.objectHeaders.delete(identity);
      }
    }
    this.candidateTransfers.clear();
    this.candidateTransfers.add(hex(this.descriptor!.transferId));
  }

  private progress(): ReceiverProgress {
    const totalBlocks = this.descriptor?.blockCount ?? 0;
    const totalBytes = Number(this.descriptor?.originalSize ?? 0n);
    const verifiedBytes = Array.from(this.blocks.values()).reduce((sum, record) => sum + record.rawLength, 0);
    return {
      transferId: this.descriptor ? hex(this.descriptor.transferId) : undefined,
      descriptor: Boolean(this.descriptor),
      manifest: Boolean(this.manifest),
      blocks: this.blocks.size,
      totalBlocks,
      verifiedBytes,
      totalBytes,
      complete: this.fileVerified,
      needsPassword: Boolean(this.descriptor?.cryptoSuite === 1 && !this.key),
      fileName: this.manifest?.fileName,
      status: this.status,
      persistent: Boolean(this.objectStore?.persistent),
      lastError: this.lastError,
    };
  }

  private reset(): void {
    for (const state of this.objects.values()) state.decoder.dispose();
    this.metadata = undefined;
    this.descriptor = undefined;
    this.descriptorBytes = undefined;
    this.manifest = undefined;
    this.manifestWire = undefined;
    this.key = undefined;
    this.pendingPassword = undefined;
    this.objects.clear();
    this.objectHeaders.clear();
    this.completedObjects.clear();
    this.candidateTransfers.clear();
    this.blocks.clear();
    this.blockWire.clear();
    this.status = 'waiting-control';
    this.lastError = undefined;
    this.fileVerified = false;
  }
}

function hashHex(bytes: Uint8Array): string {
  return hex(hash(bytes));
}
