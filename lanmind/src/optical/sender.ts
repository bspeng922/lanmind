import { encodeLmftPackets, repairBudget } from './core/fec';
import { prepareTransfer, type PrepareOptions } from './core/prepare';
import type { PreparedTransfer } from './core/types';

export interface SenderOptions extends PrepareOptions {
  repairPercent?: number;
}

export interface TransferPacketSource {
  readonly length: number;
  get(index: number): Promise<Uint8Array>;
}

export async function prepareOpticalTransfer(file: Blob, options: SenderOptions = {}): Promise<PreparedTransfer> {
  return prepareTransfer(file, options);
}

export async function buildTransferPackets(transfer: PreparedTransfer, signal?: AbortSignal): Promise<Uint8Array[]> {
  const packets: Uint8Array[] = [];
  const append = async (bytes: Uint8Array, kind: 0 | 1 | 2, objectId: number, symbolSize: number): Promise<void> => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const repair = repairBudget(bytes.length, symbolSize);
    packets.push(...await encodeLmftPackets(bytes, kind, objectId, transfer.descriptor.transferId, symbolSize, repair));
  };
  await append(transfer.descriptorBytes, 0, 0, transfer.descriptor.controlSymbolSize);
  await append(transfer.manifestWire, 1, 1, transfer.descriptor.controlSymbolSize);
  for (const block of transfer.blocks) await append(await (transfer.loadBlock?.(block) ?? block.wire), 2, block.objectId, transfer.descriptor.dataSymbolSize);
  return packets;
}

/** Random-access packet source for the player. It retains only one encoded
 * object at a time, so a large transfer does not become one giant packet array. */
export function createTransferPacketSource(transfer: PreparedTransfer, signal?: AbortSignal): TransferPacketSource {
  const descriptors = [
    { kind: 0 as const, objectId: 0, length: transfer.descriptorBytes.length, symbolSize: transfer.descriptor.controlSymbolSize, load: async () => transfer.descriptorBytes },
    { kind: 1 as const, objectId: 1, length: transfer.manifestWire.length, symbolSize: transfer.descriptor.controlSymbolSize, load: async () => transfer.manifestWire },
    ...transfer.blocks.map((block) => ({ kind: 2 as const, objectId: block.objectId, length: block.wireSha256.length ? block.wire.length : 0, symbolSize: transfer.descriptor.dataSymbolSize, load: () => transfer.loadBlock?.(block) ?? Promise.resolve(block.wire), block })),
  ];
  // For persisted blocks wire is intentionally empty; the manifest carries
  // the exact encoded length and is therefore the authoritative count input.
  for (const item of descriptors) if (item.kind === 2) item.length = transfer.manifest.records[item.objectId - 2].wireLength;
  const counts = descriptors.map((item) => {
    const sourceCount = Math.ceil(item.length / item.symbolSize);
    const repairCount = Math.max(1, Math.ceil(sourceCount * repairBudget(item.length, item.symbolSize) / 100));
    return sourceCount + repairCount;
  });
  const offsets: number[] = [];
  let total = 0;
  for (const count of counts) { offsets.push(total); total += count; }
  let cachedObject = -1;
  let cachedPackets: Uint8Array[] = [];
  return {
    length: total,
    async get(index: number): Promise<Uint8Array> {
      if (!Number.isInteger(index) || index < 0 || index >= total) throw new RangeError('packet index out of range');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      let objectIndex = 0;
      for (let candidate = 1; candidate < offsets.length; candidate += 1) {
        if (offsets[candidate] > index) break;
        objectIndex = candidate;
      }
      const local = index - offsets[objectIndex];
      if (cachedObject !== objectIndex) {
        const item = descriptors[objectIndex];
        cachedPackets = await encodeLmftPackets(await item.load(), item.kind, item.objectId, transfer.descriptor.transferId, item.symbolSize, repairBudget(item.length, item.symbolSize));
        cachedObject = objectIndex;
      }
      const packet = cachedPackets[local];
      if (!packet) throw new Error('PACKET_SEQUENCE_MISMATCH');
      return packet;
    },
  };
}

export async function* transferPacketStream(transfer: PreparedTransfer, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const append = async function* (bytes: Uint8Array, kind: 0 | 1 | 2, objectId: number, symbolSize: number): AsyncGenerator<Uint8Array> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const packets = await encodeLmftPackets(bytes, kind, objectId, transfer.descriptor.transferId, symbolSize, repairBudget(bytes.length, symbolSize));
    for (const packet of packets) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      yield packet;
    }
  };
  yield* append(transfer.descriptorBytes, 0, 0, transfer.descriptor.controlSymbolSize);
  yield* append(transfer.manifestWire, 1, 1, transfer.descriptor.controlSymbolSize);
  for (const block of transfer.blocks) yield* append(await (transfer.loadBlock?.(block) ?? block.wire), 2, block.objectId, transfer.descriptor.dataSymbolSize);
}
