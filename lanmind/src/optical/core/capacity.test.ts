import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightTransferCapacity, selectRawBlockSize } from './capacity';
import { MAX_PROTOCOL_FILE_SIZE, RECOMMENDED_TRANSFER_SIZE } from './types';

test('capacity preflight uses streamed metadata rather than a giant allocation', () => {
  const sizes = [0, RECOMMENDED_TRANSFER_SIZE - 1, RECOMMENDED_TRANSFER_SIZE + 1, 8 * 1024 * 1024 * 1024];
  for (const size of sizes) {
    const result = preflightTransferCapacity(size);
    assert.equal(result.canContinue, true);
    assert.ok(result.blockCount <= 4096);
    assert.equal(result.estimatedCacheBytes >= size, true);
  }
  assert.equal(selectRawBlockSize(MAX_PROTOCOL_FILE_SIZE + 1), undefined);
  assert.equal(preflightTransferCapacity(MAX_PROTOCOL_FILE_SIZE + 1).canContinue, false);
});
