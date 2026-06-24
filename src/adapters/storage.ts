/**
 * 存储适配层（StorageAdapter，TECH §7.7）：统一封装「选图 → 压缩 → 上传 → 取公开 URL」。
 * 业务层只调本文件的 pickAndUpload*，不直接碰 supabase.storage —— 将来从 Supabase Storage
 * 切到阿里云 OSS 时，只需替换本文件实现。
 *
 * 约定（与迁移 0022 的 RLS 一致）：
 *   - 两个 public 桶；读走公开 CDN，写受 RLS 管控（不开放客户端删除）。
 *   - 头像路径 {userId}.jpg、封面路径 {familyId}.jpg —— 文件名（去扩展名）即归属 id。
 *     刻意放在桶根目录、不建子文件夹：本自托管实例的 storage.prefixes 表开了 RLS，却归
 *     supabase_storage_admin 独占、postgres 无权加策略；一旦路径含子文件夹，上传会因触发器
 *     向 prefixes 插行被 RLS 拒而失败（报 new row violates row-level security policy）。
 *     根目录对象不触发 prefixes 写入，从根上规避该限制。
 *   - upsert 需要 SELECT 策略：storage 上传是 `insert ... on conflict do update returning *`，
 *     ON CONFLICT 读冲突行、RETURNING 读回行都要 objects 上有 SELECT 策略；只建写策略
 *     会被 RLS 拒。故 0022 给两桶各加一条 SELECT（桶本就公开，TO public）。
 *   - 写按 owner 列把关：本实例 auth.uid() 在 storage 上下文取不到，故不依赖它，改用
 *     storage 服务端盖在 objects.owner / owner_id 的真实 uid（客户端伪造不了）——头像
 *     「文件名 = owner」、封面「owner 须为该家庭户主」。详见迁移 0022 注释。
 *   - 自托管开源 Supabase 无服务端图片变换，故上传前在客户端压缩为方形 JPEG。
 */
import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

export const AVATAR_BUCKET = 'homebook-user-avatars';
export const FAMILY_COVER_BUCKET = 'homebook-family-covers';

/** 头像/封面统一方形边长（px）。自托管无服务端变换，故落地即最终尺寸。 */
const IMAGE_SIZE = 512;
/** JPEG 压缩质量（0–1）。 */
const COMPRESS_QUALITY = 0.8;

/** 用户主动取消选图（非错误，UI 静默处理）。 */
export class PickCanceledError extends Error {
  constructor() {
    super('canceled');
    this.name = 'PickCanceledError';
  }
}

/** 相册权限被拒（UI 提示去设置开启）。 */
export class PermissionDeniedError extends Error {
  constructor() {
    super('相册权限未授予');
    this.name = 'PermissionDeniedError';
  }
}

/** 弹相册选图（方形裁剪），取消则抛 PickCanceledError，无权限抛 PermissionDeniedError。 */
async function pickSquareImage(): Promise<string> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new PermissionDeniedError();

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) throw new PickCanceledError();
  return res.assets[0].uri;
}

/** 压缩为方形 JPEG，返回 base64（不含 data: 前缀）。 */
async function compressToBase64(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: IMAGE_SIZE, height: IMAGE_SIZE });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({
    compress: COMPRESS_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error('图片压缩失败');
  return out.base64;
}

/** 上传到 public 桶（同路径 upsert 覆盖），返回带时间戳的公开 URL（破缓存）。 */
async function uploadPublic(bucket: string, path: string, base64: string): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  // 路径固定（覆盖上传），URL 不变会命中 CDN/本地旧缓存；追加版本参数强制刷新。
  return `${data.publicUrl}?v=${Date.now()}`;
}

/** 选图并上传为「我的头像」，返回公开 URL；取消返回 null。 */
export async function pickAndUploadAvatar(userId: string): Promise<string | null> {
  let uri: string;
  try {
    uri = await pickSquareImage();
  } catch (e) {
    if (e instanceof PickCanceledError) return null;
    throw e;
  }
  const base64 = await compressToBase64(uri);
  return uploadPublic(AVATAR_BUCKET, `${userId}.jpg`, base64);
}

/** 选图并上传为「家庭头像/封面」，返回公开 URL；取消返回 null。仅户主有写权限（RLS 兜底）。 */
export async function pickAndUploadFamilyCover(familyId: string): Promise<string | null> {
  let uri: string;
  try {
    uri = await pickSquareImage();
  } catch (e) {
    if (e instanceof PickCanceledError) return null;
    throw e;
  }
  const base64 = await compressToBase64(uri);
  return uploadPublic(FAMILY_COVER_BUCKET, `${familyId}.jpg`, base64);
}
