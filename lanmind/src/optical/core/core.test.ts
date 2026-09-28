import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { preflightTransferCapacity, selectRawBlockSize } from './capacity';
import { crc32c } from './crc32c';
import { encodeFecObject, encodeLmftPackets, fecPacketCount, initializeRaptor } from './fec';
import { prepareTransfer } from './prepare';
import { decodeDescriptor, decodePacket, encodeDescriptor } from './protocol';
import { OpticalReceiverSession } from './receive';
import { MAX_PROTOCOL_FILE_SIZE, RECOMMENDED_TRANSFER_SIZE, type Descriptor } from './types';
import { createTransferPacketSource } from '../sender';
import { MemoryObjectStore } from '../storage/objectStore';

const raptorWasmBytes = await readFile(new URL('../../../node_modules/@raptorqr/raptorq-wasm/src/wasm/raptorqr_raptorq_wasm_bg.wasm', import.meta.url));
await initializeRaptor(raptorWasmBytes);

function deterministicBytes(length: number): Uint8Array {
  const source = new Uint8Array(length);
  for (let index = 0; index < source.length; index += 1) source[index] = (index * 31 + 17) & 0xff;
  return source;
}

async function packetsFor(transfer: Awaited<ReturnType<typeof prepareTransfer>>, repairPercent = 10): Promise<Uint8Array[]> {
  const packets: Uint8Array[] = [];
  packets.push(...await encodeLmftPackets(transfer.descriptorBytes, 0, 0, transfer.descriptor.transferId, 256, repairPercent));
  packets.push(...await encodeLmftPackets(transfer.manifestWire, 1, 1, transfer.descriptor.transferId, 256, repairPercent));
  for (const block of transfer.blocks) {
    packets.push(...await encodeLmftPackets(await (transfer.loadBlock?.(block) ?? block.wire), 2, block.objectId, transfer.descriptor.transferId, 960, repairPercent));
  }
  return packets;
}

async function roundTrip(password?: string): Promise<void> {
  const source = deterministicBytes(5000);
  const transfer = await prepareTransfer(new Blob([source], { type: 'application/octet-stream' }), { fileName: '测试.bin', password, blockSize: 262144, dataSymbolSize: 960 });
  const packets = await packetsFor(transfer);
  packets.reverse();
  const receiver = new OpticalReceiverSession();
  for (const packet of packets) await receiver.pushPacketBytes(packet);
  if (password) await receiver.setPassword(password);
  const output = await receiver.buildFile();
  assert.equal(output.name, '测试.bin');
  assert.equal(receiver.getProgress().status, 'verified');
  assert.deepEqual(new Uint8Array(await output.blob.arrayBuffer()), source);
}

function descriptorForSize(size: number, blockSize: number): Descriptor {
  return {
    version: 1,
    cryptoSuite: 0,
    kdf: 0,
    transferId: new Uint8Array(16).fill(1),
    salt: new Uint8Array(16),
    iterations: 0,
    noncePrefix: new Uint8Array(8),
    rawBlockSize: blockSize,
    blockCount: size === 0 ? 0 : Math.ceil(size / blockSize),
    originalSize: BigInt(size),
    manifestWireLength: 80,
    manifestWireSha256: new Uint8Array(32).fill(2),
    dataSymbolSize: 960,
    controlSymbolSize: 256,
    flags: 0,
  };
}

test('CRC32C reference vector', () => {
  assert.equal(crc32c(new TextEncoder().encode('123456789')), 0xe3069283);
});

test('LMFT plain and encrypted transfers recover reverse-ordered packets', async () => {
  await roundTrip();
  await roundTrip('correct horse battery staple');
});

test('empty transfer is verified after its control objects arrive', async () => {
  const transfer = await prepareTransfer(new Blob([]), { fileName: 'empty.bin' });
  const receiver = new OpticalReceiverSession();
  for (const packet of await packetsFor(transfer)) await receiver.pushPacketBytes(packet);
  assert.equal(receiver.getProgress().complete, true);
  assert.equal((await receiver.buildFile()).blob.size, 0);
});

test('1 GiB is advisory and larger valid layouts round-trip through descriptor metadata', () => {
  const aboveRecommendation = RECOMMENDED_TRANSFER_SIZE + 1;
  const preflight = preflightTransferCapacity(aboveRecommendation);
  assert.equal(preflight.canContinue, true);
  assert.equal(preflight.recommended, false);
  assert.equal(preflight.blockSize, 1024 * 1024);
  assert.deepEqual(decodeDescriptor(encodeDescriptor(descriptorForSize(aboveRecommendation, preflight.blockSize))), descriptorForSize(aboveRecommendation, preflight.blockSize));

  assert.equal(selectRawBlockSize(4 * 1024 * 1024 * 1024), 1024 * 1024);
  assert.equal(selectRawBlockSize(4 * 1024 * 1024 * 1024 + 1), 2 * 1024 * 1024);
  assert.equal(preflightTransferCapacity(MAX_PROTOCOL_FILE_SIZE).canContinue, true);
  assert.equal(preflightTransferCapacity(MAX_PROTOCOL_FILE_SIZE + 1).reason, 'PROTOCOL_LAYOUT_LIMIT');
});

test('descriptor rejects inconsistent and unsupported block layouts', () => {
  assert.throws(() => encodeDescriptor({ ...descriptorForSize(1024, 1024 * 1024), blockCount: 2 }), /inconsistent block layout/);
  assert.throws(() => encodeDescriptor(descriptorForSize(1024, 12345)), /invalid raw block size/);
});

test('FEC repair input is a percentage and predicted packet counts match the codec', async () => {
  for (const length of [1, 5000, 262144]) {
    const symbols = await encodeFecObject(deterministicBytes(length), 960, 10);
    assert.equal(symbols.length, fecPacketCount(length, 960, 10));
    assert.equal(new Set(symbols.map((item) => item.encodingSymbolId)).size, symbols.length);
  }
});

test('bounded packet source interleaves control frames through data', async () => {
  const transfer = await prepareTransfer(new Blob([deterministicBytes(700000)]), { fileName: 'stream.bin', blockSize: 262144, dataSymbolSize: 960 });
  const source = createTransferPacketSource(transfer);
  assert.equal(source.length, source.controlPackets + source.dataPackets);
  let consecutiveData = 0;
  let maxConsecutiveData = 0;
  let descriptorFrames = 0;
  let manifestFrames = 0;
  for (let index = 0; index < source.length; index += 1) {
    const kind = decodePacket(await source.get(index)).header.kind;
    if (kind === 2) {
      consecutiveData += 1;
      maxConsecutiveData = Math.max(maxConsecutiveData, consecutiveData);
    } else {
      consecutiveData = 0;
      if (kind === 0) descriptorFrames += 1;
      else manifestFrames += 1;
    }
  }
  assert.ok(descriptorFrames >= 1);
  assert.ok(manifestFrames > descriptorFrames);
  assert.ok(maxConsecutiveData <= 7);
});

test('one corrupt packet does not poison subsequent valid input', async () => {
  const transfer = await prepareTransfer(new Blob([deterministicBytes(5000)]), { fileName: 'recover.bin' });
  const packets = await packetsFor(transfer);
  const corrupt = packets[0].slice();
  corrupt[64] ^= 0xff;
  await assert.rejects(() => new OpticalReceiverSession().pushPacketBytes(corrupt), /PACKET_CRC_FAILED|OBJECT_HASH_FAILED/);

  const receiver = new OpticalReceiverSession();
  await assert.rejects(() => receiver.pushPacketBytes(corrupt));
  for (const packet of packets) await receiver.pushPacketBytes(packet);
  assert.equal(receiver.getProgress().complete, true);
});

test('wrong password remains retryable and never commits the candidate key', async () => {
  const source = deterministicBytes(5000);
  const transfer = await prepareTransfer(new Blob([source]), { fileName: 'secret.bin', password: 'right' });
  const receiver = new OpticalReceiverSession();
  for (const packet of await packetsFor(transfer)) await receiver.pushPacketBytes(packet);
  await assert.rejects(() => receiver.setPassword('wrong'), /AUTH_FAILED/);
  assert.equal(receiver.getProgress().needsPassword, true);
  await receiver.setPassword('right');
  assert.equal(receiver.getProgress().complete, true);
  assert.deepEqual(new Uint8Array(await (await receiver.buildFile()).blob.arrayBuffer()), source);
});

test('conflicting descriptor bytes are rejected without changing the active transfer', async () => {
  const transfer = await prepareTransfer(new Blob([deterministicBytes(2000)]), { fileName: 'conflict.bin' });
  const receiver = new OpticalReceiverSession();
  for (const packet of await encodeLmftPackets(transfer.descriptorBytes, 0, 0, transfer.descriptor.transferId, 256, 10)) await receiver.pushPacketBytes(packet);
  const conflicting = encodeDescriptor({ ...transfer.descriptor, manifestWireSha256: new Uint8Array(32).fill(9) });
  const conflictPackets = await encodeLmftPackets(conflicting, 0, 0, transfer.descriptor.transferId, 256, 10);
  await assert.rejects(() => receiver.pushPacketBytes(conflictPackets[0]), /OBJECT_CONFLICT/);
  assert.equal(receiver.getProgress().descriptor, true);
});

test('completed objects ignore duplicate and repair packets without changing progress', async () => {
  const transfer = await prepareTransfer(new Blob([deterministicBytes(5000)]), { fileName: 'duplicate.bin' });
  const packets = await packetsFor(transfer, 20);
  const receiver = new OpticalReceiverSession();
  for (const packet of packets) await receiver.pushPacketBytes(packet);
  const before = receiver.getProgress();
  for (let round = 0; round < 3; round += 1) for (const packet of packets) await receiver.pushPacketBytes(packet);
  assert.deepEqual(receiver.getProgress(), before);
});

test('verified wire blocks restore from local session storage', async () => {
  const source = deterministicBytes(600000);
  const store = new MemoryObjectStore(16 * 1024 * 1024);
  const transfer = await prepareTransfer(new Blob([source]), { fileName: 'restore.bin', password: 'password', blockSize: 262144 });
  const receiver = new OpticalReceiverSession(store);
  for (const packet of await packetsFor(transfer)) await receiver.pushPacketBytes(packet);
  await receiver.setPassword('password');
  assert.equal(receiver.getProgress().complete, true);

  const restored = new OpticalReceiverSession(store);
  await restored.restoreLatest();
  assert.equal(restored.getProgress().needsPassword, true);
  await restored.setPassword('password');
  assert.equal(restored.getProgress().complete, true);
  assert.deepEqual(new Uint8Array(await (await restored.buildFile()).blob.arrayBuffer()), source);
  await restored.abandon();
  await assert.rejects(() => new OpticalReceiverSession(store).restoreLatest(), /SESSION_NOT_FOUND/);
});

test('memory object store enforces its byte budget and scoped cleanup', async () => {
  const store = new MemoryObjectStore(8);
  await store.put('optical/a/one', new Uint8Array(4));
  await store.put('optical/b/two', new Uint8Array(4));
  await assert.rejects(() => store.put('optical/a/three', new Uint8Array(1)), /MEMORY_STORE_LIMIT/);
  await store.clear('optical/a/');
  assert.deepEqual(await store.keys('optical/'), ['optical/b/two']);
  await assert.rejects(() => store.clear(''));
});
