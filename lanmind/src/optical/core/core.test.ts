import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeLmftPackets, initializeRaptor } from './fec';
import { prepareTransfer } from './prepare';
import { OpticalReceiverSession } from './receive';
import { crc32c } from './crc32c';
import { createTransferPacketSource } from '../sender';

const raptorWasmBytes = await readFile(new URL('../../../node_modules/@raptorqr/raptorq-wasm/src/wasm/raptorqr_raptorq_wasm_bg.wasm', import.meta.url));
await initializeRaptor(raptorWasmBytes);

async function roundTrip(password?: string) {
  const source = new Uint8Array(5000);
  for (let index = 0; index < source.length; index += 1) source[index] = (index * 31) & 0xff;
  const transfer = await prepareTransfer(new Blob([source], { type: 'application/octet-stream' }), { fileName: '测试.bin', password, blockSize: 262144, dataSymbolSize: 960 });
  const packets: Uint8Array[] = [];
  packets.push(...await encodeLmftPackets(transfer.descriptorBytes, 0, 0, transfer.descriptor.transferId, 256, 10));
  packets.push(...await encodeLmftPackets(transfer.manifestWire, 1, 1, transfer.descriptor.transferId, 256, 10));
  for (const block of transfer.blocks) packets.push(...await encodeLmftPackets(block.wire, 2, block.objectId, transfer.descriptor.transferId, 960, 10));
  packets.reverse();
  const receiver = new OpticalReceiverSession();
  for (const packet of packets) await receiver.pushPacketBytes(packet);
  if (password) await receiver.setPassword(password);
  const output = await receiver.buildFile();
  assert.equal(output.name, '测试.bin');
  assert.equal(receiver.getFileName(), '测试.bin');
  assert.equal(receiver.getProgress().fileName, '测试.bin');
  assert.deepEqual(new Uint8Array(await output.blob.arrayBuffer()), source);
}

test('CRC32C reference vector', () => { assert.equal(crc32c(new TextEncoder().encode('123456789')), 0xe3069283); });
test('LMFT plain transfer recovers bytes after reverse packet order', async () => { await roundTrip(); });
test('LMFT encrypted transfer authenticates and recovers bytes', async () => { await roundTrip('correct horse battery staple'); });

test('streaming packet source serves packets without retaining the packet list', async () => {
  const transfer = await prepareTransfer(new Blob([new Uint8Array(1500)]), { fileName: 'stream.bin', blockSize: 262144, dataSymbolSize: 960 });
  const source = createTransferPacketSource(transfer);
  assert.ok(source.length > 0);
  const first = await source.get(0);
  const last = await source.get(source.length - 1);
  assert.equal(first[0], 0x4c);
  assert.equal(last[0], 0x4c);
});

test('receiver checkpoints verified blocks and restores them', async () => {
  const source = new Uint8Array(5000);
  source.fill(7);
  const transfer = await prepareTransfer(new Blob([source]), { fileName: 'checkpoint.bin', blockSize: 262144, dataSymbolSize: 960 });
  const packets = await encodeLmftPackets(transfer.descriptorBytes, 0, 0, transfer.descriptor.transferId, 256, 10);
  packets.push(...await encodeLmftPackets(transfer.manifestWire, 1, 1, transfer.descriptor.transferId, 256, 10));
  for (const block of transfer.blocks) packets.push(...await encodeLmftPackets(block.wire, 2, block.objectId, transfer.descriptor.transferId, 960, 10));
  const receiver = new OpticalReceiverSession();
  for (const packet of packets) await receiver.pushPacketBytes(packet);
  const checkpoint = receiver.exportCheckpoint();
  const restored = new OpticalReceiverSession();
  await restored.importCheckpoint(checkpoint);
  const output = await restored.buildFile();
  assert.deepEqual(new Uint8Array(await output.blob.arrayBuffer()), source);
});
