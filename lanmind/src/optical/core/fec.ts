import initRaptor, { encode_packets, RaptorQDecoder } from '@raptorqr/raptorq-wasm';
import { encodePacket, raptorPacketPayload, sha256ObjectTag } from './protocol';
import { type PacketHeader, type PacketKind } from './types';

let ready: Promise<void> | undefined;

/** Initialize the codec once. Node callers can provide bytes explicitly. */
export async function initializeRaptor(wasm?: BufferSource): Promise<void> {
  ready ??= (wasm === undefined ? initRaptor() : initRaptor({ module_or_path: wasm })).then(() => undefined);
  await ready;
}

async function ensureRaptor(): Promise<void> { await initializeRaptor(); }

export interface FecSymbol {
  encodingSymbolId: number;
  symbol: Uint8Array;
}

export async function encodeFecObject(bytes: Uint8Array, symbolSize: number, repairPercent: number): Promise<FecSymbol[]> {
  await ensureRaptor();
  if (!Number.isFinite(repairPercent) || repairPercent < 0 || repairPercent > 100) throw new RangeError('invalid repair percent');
  const packets = encode_packets(bytes, symbolSize + 4, Math.floor(repairPercent));
  return packets.map((packet) => ({
    encodingSymbolId: ((packet[1] << 16) | (packet[2] << 8) | packet[3]) >>> 0,
    symbol: new Uint8Array(packet).slice(4),
  }));
}

export async function encodeLmftPackets(
  bytes: Uint8Array,
  kind: PacketKind,
  objectId: number,
  transferId: Uint8Array,
  symbolSize: number,
  repairPercent: number,
): Promise<Uint8Array[]> {
  const symbols = await encodeFecObject(bytes, symbolSize, repairPercent);
  const objectTag = sha256ObjectTag(bytes);
  return symbols.map((item) => encodePacket({
    wireVersion: 1,
    kind,
    transferId,
    objectId,
    encodedLength: bytes.length,
    symbolSize,
    fecProfile: 1,
    flags: 0,
    objectTag,
    sourceBlockNumber: 0,
    encodingSymbolId: item.encodingSymbolId,
  }, item.symbol));
}

export class FecObjectDecoder {
  private decoder?: RaptorQDecoder;
  private readonly seen = new Set<number>();
  private completed?: Uint8Array;

  constructor(readonly encodedLength: number, readonly symbolSize: number) {}

  async push(encodingSymbolId: number, symbol: Uint8Array): Promise<Uint8Array | undefined> {
    if (this.completed || this.seen.has(encodingSymbolId)) return this.completed;
    if (symbol.length !== this.symbolSize) throw new Error('symbol size mismatch');
    await ensureRaptor();
    this.decoder ??= new RaptorQDecoder(this.encodedLength, this.symbolSize + 4);
    const payload = raptorPacketPayload({ encodingSymbolId } as PacketHeader, symbol);
    this.seen.add(encodingSymbolId);
    const result = this.decoder.push(payload);
    if (result) this.completed = new Uint8Array(result).slice(0, this.encodedLength);
    return this.completed;
  }

  get receivedSymbols(): number { return this.seen.size; }

  dispose(): void {
    this.decoder?.free();
    this.decoder = undefined;
    this.seen.clear();
    this.completed = undefined;
  }
}

export const DEFAULT_REPAIR_PERCENT = 10;

export function fecPacketCount(encodedLength: number, symbolSize: number, repairPercent = DEFAULT_REPAIR_PERCENT): number {
  if (!Number.isInteger(encodedLength) || encodedLength <= 0 || !Number.isInteger(symbolSize) || symbolSize <= 0) throw new RangeError('invalid FEC object');
  if (!Number.isFinite(repairPercent) || repairPercent < 0 || repairPercent > 100) throw new RangeError('invalid repair percent');
  const sourcePackets = Math.max(1, Math.ceil(encodedLength / symbolSize));
  return sourcePackets + Math.ceil(sourcePackets * Math.floor(repairPercent) / 100);
}
