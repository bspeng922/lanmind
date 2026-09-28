export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error('invalid hex');
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i += 1) output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return output;
}

export function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

export class ByteWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(value: number): this { this.view.setUint8(this.offset, value); this.offset += 1; return this; }
  u16(value: number): this { this.view.setUint16(this.offset, value, true); this.offset += 2; return this; }
  u32(value: number): this { this.view.setUint32(this.offset, value, true); this.offset += 4; return this; }
  u64(value: bigint): this { this.view.setBigUint64(this.offset, value, true); this.offset += 8; return this; }
  raw(value: Uint8Array): this { this.bytes.set(value, this.offset); this.offset += value.length; return this; }
  finish(): Uint8Array {
    if (this.offset !== this.bytes.length) throw new Error(`writer offset ${this.offset} != ${this.bytes.length}`);
    return this.bytes;
  }
}

export class ByteReader {
  private readonly view: DataView;
  private offset = 0;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get remaining(): number { return this.bytes.length - this.offset; }
  u8(): number { this.need(1); const value = this.view.getUint8(this.offset); this.offset += 1; return value; }
  u16(): number { this.need(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32(): number { this.need(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  u64(): bigint { this.need(8); const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  raw(length: number): Uint8Array { this.need(length); const value = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return value; }
  private need(length: number): void { if (!Number.isInteger(length) || length < 0 || this.remaining < length) throw new Error('truncated binary value'); }
}
