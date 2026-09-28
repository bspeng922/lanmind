export type OpticalErrorCode =
  | 'AUTH_FAILED'
  | 'INCOMPATIBLE_SESSION'
  | 'NEED_MORE_DATA'
  | 'OBJECT_CONFLICT'
  | 'OBJECT_HASH_FAILED'
  | 'RAW_HASH_FAILED'
  | 'FILE_HASH_FAILED'
  | 'RECEIVER_RESOURCE_LIMIT'
  | 'SESSION_NOT_FOUND';

export class OpticalTransferError extends Error {
  constructor(readonly code: OpticalErrorCode, readonly recoverable = true) {
    super(code);
    this.name = 'OpticalTransferError';
  }
}

export function opticalError(cause: unknown, fallback: OpticalErrorCode): OpticalTransferError {
  if (cause instanceof OpticalTransferError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const known: OpticalErrorCode[] = [
    'AUTH_FAILED', 'INCOMPATIBLE_SESSION', 'NEED_MORE_DATA', 'OBJECT_CONFLICT',
    'OBJECT_HASH_FAILED', 'RAW_HASH_FAILED', 'FILE_HASH_FAILED',
    'RECEIVER_RESOURCE_LIMIT', 'SESSION_NOT_FOUND',
  ];
  return new OpticalTransferError(known.includes(message as OpticalErrorCode) ? message as OpticalErrorCode : fallback);
}
