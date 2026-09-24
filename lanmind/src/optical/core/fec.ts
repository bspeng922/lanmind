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

export async function encodeFecObject(bytes: Uint8Array, symbolSize: number, repairCount: number): Promise<FecSymbol[]> {
  await ensureRaptor();
  try {
    const packets = encode_packets(bytes, symbolSize + 4, Math.max(0, Math.floor(repairCount)));
    return packets.map((packet) => ({
      encodingSymbolId: ((packet[1] << 16) | (packet[2] << 8) | packet[3]) >>> 0,
      symbol: new Uint8Array(packet).slice(4),
    }));
  } finally { /* wasm encoder is an allocation-free function */ }
}

export async function encodeLmftPackets(
  bytes: Uint8Array,
  kind: PacketKind,
  objectId: number,
  transferId: Uint8Array,
  symbolSize: number,
  repairCount: number,
): Promise<Uint8Array[]> {
  const symbols = await encodeFecObject(bytes, symbolSize, repairCount);
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
  }
}

export function repairBudget(encodedLength: number, symbolSize: number): number {
  const k = Math.ceil(encodedLength / symbolSize);
  return Math.max(8, Math.ceil(k * 0.05));
}
