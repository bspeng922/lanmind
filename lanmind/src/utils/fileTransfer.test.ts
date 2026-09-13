import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFileSize } from './fileTransfer';

test('formats 0 or empty bytes as 0 B', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(null), '0 B');
  assert.equal(formatFileSize(undefined), '0 B');
  assert.equal(formatFileSize(-100), '0 B');
  assert.equal(formatFileSize(NaN), '0 B');
});

test('formats byte sizes under 1 KB as B', () => {
  assert.equal(formatFileSize(1), '1 B');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1023), '1023 B');
});

test('formats kilobyte sizes from 1 KB up to 1 MB', () => {
  assert.equal(formatFileSize(1024), '1.0 KB');
  assert.equal(formatFileSize(3174), '3.1 KB');
  assert.equal(formatFileSize(7065), '6.9 KB');
  assert.equal(formatFileSize(27545), '26.9 KB');
  assert.equal(formatFileSize(1024 * 1023), '1023.0 KB');
});

test('formats megabyte sizes from 1 MB up to 1 GB', () => {
  assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
  assert.equal(formatFileSize(5.5 * 1024 * 1024), '5.5 MB');
  assert.equal(formatFileSize(500 * 1024 * 1024), '500.0 MB');
});

test('formats gigabyte sizes above 1 GB', () => {
  assert.equal(formatFileSize(1024 * 1024 * 1024), '1.00 GB');
  assert.equal(formatFileSize(2.56 * 1024 * 1024 * 1024), '2.56 GB');
});
