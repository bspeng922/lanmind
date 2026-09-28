import {
  DEFAULT_RAW_BLOCK_SIZE,
  MAX_BLOCKS,
  MAX_PROTOCOL_FILE_SIZE,
  RAW_BLOCK_SIZES,
  RECOMMENDED_TRANSFER_SIZE,
} from './types';

export type CapacityRejection =
  | 'INVALID_FILE_SIZE'
  | 'INVALID_BLOCK_SIZE'
  | 'PROTOCOL_LAYOUT_LIMIT'
  | 'STORAGE_CAPACITY_UNAVAILABLE'
  | 'INSUFFICIENT_STORAGE';

export interface TransferCapacityOptions {
  blockSize?: number;
  storageAvailable?: number;
  requirePersistentStorage?: boolean;
  persistentStorage?: boolean;
}

export interface TransferCapacityResult {
  canContinue: boolean;
  recommended: boolean;
  blockSize: number;
  blockCount: number;
  estimatedCacheBytes: number;
  reason?: CapacityRejection;
}

function validSize(size: number): boolean {
  return Number.isSafeInteger(size) && size >= 0;
}

export function selectRawBlockSize(fileSize: number): number | undefined {
  if (!validSize(fileSize)) return undefined;
  for (const size of RAW_BLOCK_SIZES) {
    if (fileSize === 0 || Math.ceil(fileSize / size) <= MAX_BLOCKS) {
      return Math.max(size, DEFAULT_RAW_BLOCK_SIZE);
    }
  }
  return undefined;
}

export function preflightTransferCapacity(
  fileSize: number,
  options: TransferCapacityOptions = {},
): TransferCapacityResult {
  const requested = options.blockSize;
  const selected = requested ?? selectRawBlockSize(fileSize) ?? RAW_BLOCK_SIZES.at(-1)!;
  const base = {
    recommended: validSize(fileSize) && fileSize <= RECOMMENDED_TRANSFER_SIZE,
    blockSize: selected,
    blockCount: validSize(fileSize) && selected > 0 ? Math.ceil(fileSize / selected) : 0,
    estimatedCacheBytes: validSize(fileSize) ? fileSize + Math.ceil(fileSize / Math.max(1, selected)) * 16 : 0,
  };
  if (!validSize(fileSize)) return { ...base, canContinue: false, reason: 'INVALID_FILE_SIZE' };
  if (requested !== undefined && !RAW_BLOCK_SIZES.includes(requested as typeof RAW_BLOCK_SIZES[number])) {
    return { ...base, canContinue: false, reason: 'INVALID_BLOCK_SIZE' };
  }
  if (fileSize > MAX_PROTOCOL_FILE_SIZE || base.blockCount > MAX_BLOCKS) {
    return { ...base, canContinue: false, reason: 'PROTOCOL_LAYOUT_LIMIT' };
  }
  if (options.requirePersistentStorage && !options.persistentStorage) {
    return { ...base, canContinue: false, reason: 'STORAGE_CAPACITY_UNAVAILABLE' };
  }
  if (options.storageAvailable !== undefined && options.storageAvailable < base.estimatedCacheBytes) {
    return { ...base, canContinue: false, reason: 'INSUFFICIENT_STORAGE' };
  }
  return { ...base, canContinue: true };
}
