import { DEFAULT_REPAIR_PERCENT, encodeLmftPackets, fecPacketCount } from './core/fec';
import { prepareTransfer, type PrepareOptions } from './core/prepare';
import type { PacketKind, PreparedBlock, PreparedTransfer } from './core/types';

export interface SenderOptions extends PrepareOptions {
  repairPercent?: number;
}

export interface TransferPacketSource {
  readonly length: number;
  readonly dataPackets: number;
  readonly controlPackets: number;
  get(index: number): Promise<Uint8Array>;
}

interface EncodedObject {
  kind: PacketKind;
  objectId: number;
  length: number;
  symbolSize: number;
  load(): Promise<Uint8Array>;
}

export async function prepareOpticalTransfer(file: Blob, options: SenderOptions = {}): Promise<PreparedTransfer> {
  return prepareTransfer(file, options);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function dataObjects(transfer: PreparedTransfer): EncodedObject[] {
  return transfer.blocks.map((block: PreparedBlock) => ({
    kind: 2,
    objectId: block.objectId,
    length: transfer.manifest.records[block.objectId - 2].wireLength,
    symbolSize: transfer.descriptor.dataSymbolSize,
    load: () => transfer.loadBlock?.(block) ?? Promise.resolve(block.wire),
  }));
}

function locate(offsets: number[], index: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= index) low = middle;
    else high = middle - 1;
  }
  return low;
}

export async function buildTransferPackets(
  transfer: PreparedTransfer,
  signal?: AbortSignal,
  repairPercent = DEFAULT_REPAIR_PERCENT,
): Promise<Uint8Array[]> {
  const source = createTransferPacketSource(transfer, signal, repairPercent);
  const packets: Uint8Array[] = [];
  for (let index = 0; index < source.length; index += 1) packets.push(await source.get(index));
  return packets;
}

/**
 * Creates one bounded broadcast round. Control objects are woven through the
 * data stream; only the two control packet sets and one data object are encoded
 * at a time.
 */
export function createTransferPacketSource(
  transfer: PreparedTransfer,
  signal?: AbortSignal,
  repairPercent = DEFAULT_REPAIR_PERCENT,
): TransferPacketSource {
  const descriptor: EncodedObject = {
    kind: 0,
    objectId: 0,
    length: transfer.descriptorBytes.length,
    symbolSize: transfer.descriptor.controlSymbolSize,
    load: async () => transfer.descriptorBytes,
  };
  const manifest: EncodedObject = {
    kind: 1,
    objectId: 1,
    length: transfer.manifestWire.length,
    symbolSize: transfer.descriptor.controlSymbolSize,
    load: async () => transfer.manifestWire,
  };
  const data = dataObjects(transfer);
  const dataCounts = data.map((item) => fecPacketCount(item.length, item.symbolSize, repairPercent));
  const dataOffsets: number[] = [];
  let dataPacketCount = 0;
  for (const count of dataCounts) {
    dataOffsets.push(dataPacketCount);
    dataPacketCount += count;
  }

  const descriptorCount = fecPacketCount(descriptor.length, descriptor.symbolSize, repairPercent);
  const manifestCount = fecPacketCount(manifest.length, manifest.symbolSize, repairPercent);
  // One descriptor frame per fifteen manifest frames keeps late joiners
  // synchronized without starving the larger manifest object.
  const groupCount = Math.max(
    descriptorCount * 16,
    Math.ceil(manifestCount * 16 / 15),
    Math.ceil(dataPacketCount / 7),
  );
  const baseDataPerGroup = groupCount > 0 ? Math.floor(dataPacketCount / groupCount) : 0;
  const groupsWithExtraData = groupCount > 0 ? dataPacketCount % groupCount : 0;

  let descriptorPackets: Uint8Array[] | undefined;
  let manifestPackets: Uint8Array[] | undefined;
  let cachedDataObject = -1;
  let cachedDataPackets: Uint8Array[] = [];

  const encodeObject = async (item: EncodedObject): Promise<Uint8Array[]> => {
    checkAbort(signal);
    return encodeLmftPackets(
      await item.load(),
      item.kind,
      item.objectId,
      transfer.descriptor.transferId,
      item.symbolSize,
      repairPercent,
    );
  };

  const controlAt = async (ordinal: number): Promise<Uint8Array> => {
    if (ordinal % 16 === 0) {
      descriptorPackets ??= await encodeObject(descriptor);
      return descriptorPackets[Math.floor(ordinal / 16) % descriptorPackets.length];
    }
    manifestPackets ??= await encodeObject(manifest);
    const manifestOrdinal = ordinal - Math.floor(ordinal / 16) - 1;
    return manifestPackets[manifestOrdinal % manifestPackets.length];
  };

  const dataAt = async (ordinal: number): Promise<Uint8Array> => {
    const objectIndex = locate(dataOffsets, ordinal);
    if (cachedDataObject !== objectIndex) {
      cachedDataPackets = await encodeObject(data[objectIndex]);
      if (cachedDataPackets.length !== dataCounts[objectIndex]) throw new Error('PACKET_SEQUENCE_MISMATCH');
      cachedDataObject = objectIndex;
    }
    const packet = cachedDataPackets[ordinal - dataOffsets[objectIndex]];
    if (!packet) throw new Error('PACKET_SEQUENCE_MISMATCH');
    return packet;
  };

  const prefixLength = (group: number): number => (
    group * (1 + baseDataPerGroup) + Math.min(group, groupsWithExtraData)
  );
  const groupForIndex = (index: number): number => {
    let low = 0;
    let high = groupCount - 1;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (prefixLength(middle) <= index) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  return {
    length: groupCount + dataPacketCount,
    dataPackets: dataPacketCount,
    controlPackets: groupCount,
    async get(index: number): Promise<Uint8Array> {
      if (!Number.isInteger(index) || index < 0 || index >= groupCount + dataPacketCount) throw new RangeError('packet index out of range');
      checkAbort(signal);
      const group = groupForIndex(index);
      const local = index - prefixLength(group);
      if (local === 0) return controlAt(group);
      const dataBefore = group * baseDataPerGroup + Math.min(group, groupsWithExtraData);
      return dataAt(dataBefore + local - 1);
    },
  };
}

export async function* transferPacketStream(
  transfer: PreparedTransfer,
  signal?: AbortSignal,
  repairPercent = DEFAULT_REPAIR_PERCENT,
): AsyncGenerator<Uint8Array> {
  const source = createTransferPacketSource(transfer, signal, repairPercent);
  for (let index = 0; index < source.length; index += 1) yield await source.get(index);
}
