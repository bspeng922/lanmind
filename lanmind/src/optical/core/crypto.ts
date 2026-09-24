import { concatBytes, textEncoder } from './bytes';
import { contextHash } from './hash';
import type { Descriptor, PacketKind } from './types';
import { PBKDF2_ITERATIONS } from './types';

const AAD_PREFIX = textEncoder.encode('LMFT-AAD-v1\0');

export async function deriveTransferKey(password: string, descriptor: Descriptor): Promise<CryptoKey> {
  if (!password) throw new Error('PASSWORD_REQUIRED');
  if (descriptor.cryptoSuite !== 1 || descriptor.kdf !== 1 || descriptor.iterations !== PBKDF2_ITERATIONS) {
    throw new Error('unsupported key derivation profile');
  }
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: descriptor.salt, iterations: descriptor.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function objectIv(descriptor: Descriptor, objectId: number): Uint8Array {
  const iv = new Uint8Array(12);
  iv.set(descriptor.noncePrefix, 0);
  new DataView(iv.buffer).setUint32(8, objectId, false);
  return iv;
}

export function objectAad(
  descriptorBytes: Uint8Array,
  kind: PacketKind,
  objectId: number,
  rawOffset: bigint,
  rawLength: number,
  compression: number,
  packedLength: number,
): Uint8Array {
  const context = contextHash(descriptorBytes);
  const fields = new Uint8Array(1 + 4 + 8 + 4 + 1 + 4);
  const view = new DataView(fields.buffer);
  let offset = 0;
  view.setUint8(offset, kind); offset += 1;
  view.setUint32(offset, objectId, true); offset += 4;
  view.setBigUint64(offset, rawOffset, true); offset += 8;
  view.setUint32(offset, rawLength, true); offset += 4;
  view.setUint8(offset, compression); offset += 1;
  view.setUint32(offset, packedLength, true);
  return concatBytes(AAD_PREFIX, context, fields);
}

export async function encryptObject(
  key: CryptoKey,
  descriptor: Descriptor,
  descriptorBytes: Uint8Array,
  kind: PacketKind,
  objectId: number,
  rawOffset: bigint,
  rawLength: number,
  compression: number,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const aad = objectAad(descriptorBytes, kind, objectId, rawOffset, rawLength, compression, plaintext.length);
  return new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: objectIv(descriptor, objectId), additionalData: aad, tagLength: 128 },
    key,
    plaintext,
  ));
}

export async function decryptObject(
  key: CryptoKey,
  descriptor: Descriptor,
  descriptorBytes: Uint8Array,
  kind: PacketKind,
  objectId: number,
  rawOffset: bigint,
  rawLength: number,
  compression: number,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const packedLength = ciphertext.length - 16;
  if (packedLength < 0) throw new Error('AUTH_FAILED');
  const aad = objectAad(descriptorBytes, kind, objectId, rawOffset, rawLength, compression, packedLength);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: objectIv(descriptor, objectId), additionalData: aad, tagLength: 128 },
      key,
      ciphertext,
    ));
  } catch {
    throw new Error('AUTH_FAILED');
  }
}
