import { decode } from 'base64-arraybuffer';
import { describe, expect, it } from 'vitest';

import { base64DecodedBytes, isWithinUploadLimit, UPLOAD_MAX_BYTES } from './image-byte-limit';

/** 生成解码后恰好为 `bytes` 字节的 base64，不依赖 Node 的 Buffer。 */
function base64OfSize(bytes: number): string {
  const groups = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  const body = 'A'.repeat(groups * 4);
  if (remainder === 1) return `${body}AA==`;
  if (remainder === 2) return `${body}AAA=`;
  return body;
}

describe('upload byte limit', () => {
  it('counts decoded bytes the same way the upload payload is decoded', () => {
    expect(base64DecodedBytes('YQ==')).toBe(1);
    expect(base64DecodedBytes('YWI=')).toBe(2);
    expect(base64DecodedBytes('YWJj')).toBe(3);
    const payload = base64OfSize(100);
    expect(base64DecodedBytes(payload)).toBe(decode(payload).byteLength);
    expect(base64DecodedBytes(payload)).toBe(100);
  });

  it('allows 2MB and rejects one byte over, matching the storage bucket limit', () => {
    expect(UPLOAD_MAX_BYTES).toBe(2_097_152);
    expect(isWithinUploadLimit(base64OfSize(UPLOAD_MAX_BYTES))).toBe(true);
    expect(isWithinUploadLimit(base64OfSize(UPLOAD_MAX_BYTES + 1))).toBe(false);
  });
});
