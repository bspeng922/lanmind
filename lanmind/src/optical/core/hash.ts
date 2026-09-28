import { _SHA256, sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, textEncoder } from './bytes';

export function hash(bytes: Uint8Array): Uint8Array { return sha256(bytes); }
export function hashHex(bytes: Uint8Array): string { return bytesToHex(hash(bytes)); }
export function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(''); }

export function contextHash(descriptor: Uint8Array): Uint8Array {
  if (descriptor.length !== 128) throw new RangeError('descriptor must be 128 bytes');
  return hash(concatBytes(
    textEncoder.encode('LMFT-CONTEXT-v1\0'),
    descriptor.slice(0, 68),
    descriptor.slice(104, 128),
  ));
}

export class Sha256Stream {
  private readonly state = new _SHA256();
  update(bytes: Uint8Array): this { this.state.update(bytes); return this; }
  digest(): Uint8Array { return this.state.digest(); }
}
