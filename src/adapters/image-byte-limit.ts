/**
 * 上传对象的字节上限。四个图片桶的 file_size_limit 都是 2MB
 * （见 20260903132248_harden_storage_upload_constraints.sql），客户端按实际上传字节对齐。
 */
import { decode } from 'base64-arraybuffer';

export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** 与 storage.upload 使用的 decode 结果一致，按即将上传的字节数计算。 */
export function base64DecodedBytes(base64: string): number {
  return decode(base64).byteLength;
}

/** 等于上限可以上传；Supabase 在对象大于 file_size_limit 时拒绝。 */
export function isWithinUploadLimit(base64: string): boolean {
  return base64DecodedBytes(base64) <= UPLOAD_MAX_BYTES;
}
