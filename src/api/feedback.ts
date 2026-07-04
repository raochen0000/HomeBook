/**
 * 意见反馈（PRD §18.3.7 / DATAMODEL §5.5）：采集诊断信息 → 上传截图 → submit_feedback RPC。
 * MVP 单向提交，不读回历史；服务端 RPC 集中做校验 + 防刷，客户端只负责组装入参。
 */
import { useMutation } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { uploadFeedbackImages, type PickedImage } from '@/adapters/storage';
import { supabase } from '@/lib/supabase';

/** 反馈类型（UI「功能 / Bug / 建议 / 其它」↔ 库枚举）。 */
export type FeedbackType = 'feature' | 'bug' | 'suggestion' | 'other';

/** 分段标签展示文案，顺序即 UI 顺序（默认选「功能」）。 */
export const FEEDBACK_TYPES: { value: FeedbackType; label: string }[] = [
  { value: 'feature', label: '功能' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: '建议' },
  { value: 'other', label: '其它' },
];

/** 问题描述字数区间与截图上限（与库 CHECK / RPC 校验保持一致，供 UI 校验/计数）。 */
export const FEEDBACK_CONTENT_MIN = 5;
export const FEEDBACK_CONTENT_MAX = 200;
export const FEEDBACK_IMAGE_MAX = 5;

/** 诊断信息：定位 Bug 必需，用户不可见/不可填，提交时随附（落 feedback.device）。 */
function collectDevice(): Record<string, string | number | null> {
  return {
    app_version: Constants.expoConfig?.version ?? 'unknown',
    build:
      Platform.OS === 'ios'
        ? (Constants.expoConfig?.ios?.buildNumber ?? null)
        : (Constants.expoConfig?.android?.versionCode ?? null),
    platform: Platform.OS,
    os_version: Device.osVersion ?? String(Platform.Version),
    device_model: Device.modelName ?? 'unknown',
    brand: Device.brand ?? 'unknown',
    timezone: resolveTimezone(),
  };
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 面向用户展示的诊断信息摘要（机型 · 系统 版本 · App 版本），供反馈页透明告知。 */
export function getDeviceSummary(): string {
  const model = Device.modelName ?? '未知机型';
  const os = [Device.osName, Device.osVersion].filter(Boolean).join(' ');
  const ver = Constants.expoConfig?.version;
  return [model, os || Platform.OS, ver ? `v${ver}` : null].filter(Boolean).join(' · ');
}

export type SubmitFeedbackInput = {
  type: FeedbackType;
  content: string;
  images?: PickedImage[];
  /** 是否同意通过账号（手机/邮箱）回访，默认 true；仅表达意愿，不影响 user_id 关联。 */
  contactOk?: boolean;
};

/** 提交一条反馈：先上传截图拿桶内路径，再调 RPC 落库；返回反馈 id。 */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<string> {
  const { type, content, images = [], contactOk = true } = input;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  // 截图先传 storage（路径前缀=本人 uid，RLS 兜底），提交失败仅留孤儿对象，MVP 可接受。
  const imagePaths = images.length ? await uploadFeedbackImages(user.id, images) : [];

  const { data, error } = await supabase.rpc('submit_feedback', {
    p_type: type,
    p_content: content,
    p_image_paths: imagePaths,
    p_contact_ok: contactOk,
    p_device: collectDevice(),
  });
  if (error) throw error;
  return data;
}

/** 提交反馈的 mutation（MVP 不读回历史，故无需失效缓存）。 */
export function useSubmitFeedback() {
  return useMutation({ mutationFn: submitFeedback });
}
