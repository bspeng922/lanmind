import { hex, randomBytes, textDecoder, textEncoder } from '../core/bytes';
import { hashHex } from '../core/hash';
import type { OpticalObjectStore } from './objectStore';

export interface OpticalSessionMetadata {
  version: 1;
  sessionId: string;
  transferId: string;
  descriptorHash: string;
  encrypted: boolean;
  createdAt: string;
  updatedAt: string;
  committedBlocks: number[];
}

const ROOT = 'optical/sessions/';

function validSessionId(value: string): string {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new Error('INVALID_SESSION_ID');
  return value;
}

export class OpticalSessionStore {
  constructor(readonly objects: OpticalObjectStore) {}

  createId(): string {
    return hex(randomBytes(16));
  }

  async create(descriptor: Uint8Array, transferId: string, encrypted: boolean): Promise<OpticalSessionMetadata> {
    const now = new Date().toISOString();
    const metadata: OpticalSessionMetadata = {
      version: 1,
      sessionId: this.createId(),
      transferId,
      descriptorHash: hashHex(descriptor),
      encrypted,
      createdAt: now,
      updatedAt: now,
      committedBlocks: [],
    };
    await this.objects.put(this.key(metadata.sessionId, 'descriptor.bin'), descriptor);
    await this.commitMetadata(metadata);
    return metadata;
  }

  async commitManifest(metadata: OpticalSessionMetadata, wire: Uint8Array): Promise<void> {
    await this.objects.put(this.key(metadata.sessionId, 'manifest.wire'), wire);
    await this.touch(metadata);
  }

  async commitBlock(metadata: OpticalSessionMetadata, index: number, wire: Uint8Array): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('invalid block index');
    await this.objects.put(this.key(metadata.sessionId, `blocks/${index}.wire`), wire);
    if (!metadata.committedBlocks.includes(index)) {
      metadata.committedBlocks.push(index);
      metadata.committedBlocks.sort((a, b) => a - b);
    }
    await this.touch(metadata);
  }

  async readDescriptor(sessionId: string): Promise<Uint8Array | undefined> {
    return this.objects.get(this.key(sessionId, 'descriptor.bin'));
  }

  async readManifest(sessionId: string): Promise<Uint8Array | undefined> {
    return this.objects.get(this.key(sessionId, 'manifest.wire'));
  }

  async readBlock(sessionId: string, index: number): Promise<Uint8Array | undefined> {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('invalid block index');
    return this.objects.get(this.key(sessionId, `blocks/${index}.wire`));
  }

  async list(): Promise<OpticalSessionMetadata[]> {
    const metadataKeys = (await this.objects.keys(ROOT)).filter((key) => key.endsWith('/metadata.json'));
    const values = await Promise.all(metadataKeys.map(async (key) => {
      const bytes = await this.objects.get(key);
      if (!bytes) return undefined;
      try { return this.parseMetadata(textDecoder.decode(bytes)); } catch { return undefined; }
    }));
    return values.filter((item): item is OpticalSessionMetadata => Boolean(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async latest(): Promise<OpticalSessionMetadata | undefined> {
    return (await this.list())[0];
  }

  async delete(sessionId: string): Promise<void> {
    await this.objects.clear(`${ROOT}${validSessionId(sessionId)}/`);
  }

  async commitMetadata(metadata: OpticalSessionMetadata): Promise<void> {
    validSessionId(metadata.sessionId);
    await this.objects.put(this.key(metadata.sessionId, 'metadata.json'), textEncoder.encode(JSON.stringify(metadata)));
  }

  private async touch(metadata: OpticalSessionMetadata): Promise<void> {
    metadata.updatedAt = new Date().toISOString();
    await this.commitMetadata(metadata);
  }

  private parseMetadata(value: string): OpticalSessionMetadata {
    const item = JSON.parse(value) as OpticalSessionMetadata;
    if (item.version !== 1 || !/^[0-9a-f]{32}$/.test(item.sessionId) || !/^[0-9a-f]{32}$/.test(item.transferId) || !/^[0-9a-f]{64}$/.test(item.descriptorHash)) {
      throw new Error('INVALID_SESSION_METADATA');
    }
    if (!Array.isArray(item.committedBlocks) || item.committedBlocks.some((index) => !Number.isInteger(index) || index < 0)) throw new Error('INVALID_SESSION_METADATA');
    return item;
  }

  private key(sessionId: string, suffix: string): string {
    return `${ROOT}${validSessionId(sessionId)}/${suffix}`;
  }
}
