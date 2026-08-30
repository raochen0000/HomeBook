/**
 * G16 意见反馈（PRD §18.3.7）。RN 表单子页，视觉沿用账号子页（灰底白卡 + accent 主按钮，
 * 见 account/phone.tsx）——多行文本 + 图片网格在 @expo/ui SwiftUI 里受限，故不用原生 List。
 * 结构：反馈类型分段标签（功能/Bug/建议/其它）+ 问题描述（5–200 字必填、字数计数）
 * + 截图（≤5 张，缩略图可删）+「可否被账号联系」开关（默认开）+ 提交。
 * 提交经 useSubmitFeedback：内部先把截图传 storage 拿路径，再调 submit_feedback RPC
 * （服务端集中校验 + 防刷）；诊断信息（机型/系统/版本）由 api 自动附带。
 */
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pickFeedbackImages, PermissionDeniedError, type PickedImage } from '@/adapters/storage';
import {
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_CONTENT_MIN,
  FEEDBACK_IMAGE_MAX,
  FEEDBACK_TYPES,
  getDeviceSummary,
  useSubmitFeedback,
  type FeedbackType,
} from '@/api';
import { toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { t, useLocalePreference } from '@/i18n';

/** 图片网格：每行 5 格，格间距固定，单元格边长按屏宽自适应（见组件内计算）。 */
const GRID_COLUMNS = 5;
const GRID_GAP = Space[2];

/** 提交失败 → 友好文案（网络异常单独提示；RPC 抛出的校验/防刷 message 直接透传）。 */
function submitErrorText(err: unknown): string {
  const e = err as { message?: string; name?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (
    e?.name === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  ) {
    return t('feedback.offline');
  }
  return e?.message ?? t('feedback.submitFail');
}

export default function FeedbackScreen() {
  const palette = usePalette();
  useLocalePreference();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const submit = useSubmitFeedback();

  const [type, setType] = useState<FeedbackType>('feature');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [contactOk, setContactOk] = useState(true);

  const busy = submit.isPending;
  const trimmedLen = content.trim().length;
  const canSubmit = trimmedLen >= FEEDBACK_CONTENT_MIN && !busy;
  const remaining = FEEDBACK_IMAGE_MAX - images.length;

  // 每行 5 格填满内容区宽度（内容左右各 Space[4] 内边距）。
  const { width } = useWindowDimensions();
  const tileSize = Math.floor((width - Space[4] * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const deviceSummary = useMemo(() => getDeviceSummary(), []);

  const onAddImages = async () => {
    if (remaining <= 0 || busy) return;
    try {
      const picked = await pickFeedbackImages(remaining);
      if (picked.length) setImages((prev) => [...prev, ...picked].slice(0, FEEDBACK_IMAGE_MAX));
    } catch (e) {
      console.warn('[feedback] pickFeedbackImages failed:', e);
      toast.error(e instanceof PermissionDeniedError ? t('feedback.albumDenied') : t('feedback.imageFail'));
    }
  };

  const onRemoveImage = (uri: string) => setImages((prev) => prev.filter((i) => i.uri !== uri));

  const onSubmit = () => {
    if (!canSubmit) {
      if (trimmedLen < FEEDBACK_CONTENT_MIN) toast.error(t('feedback.minChars', { count: FEEDBACK_CONTENT_MIN }));
      return;
    }
    submit.mutate(
      { type, content: content.trim(), images, contactOk },
      {
        onSuccess: () => {
          toast.success(t('feedback.thanks'));
          // 停留片刻让用户看到成功提示，再返回上一页。
          setTimeout(() => router.back(), 800);
        },
        onError: (e) => toast.error(submitErrorText(e)),
      },
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Stack.Screen options={{ headerShown: true, title: t('feedback.title') }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6] }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* 反馈类型：分段标签，单选，默认「功能」 */}
          <Text style={[styles.label, { color: palette.textPrimary }]}>{t('feedback.type')}</Text>
          <View style={[styles.segment, { backgroundColor: palette.cardPill }]}>
            {FEEDBACK_TYPES.map((item) => {
              const active = item.value === type;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setType(item.value)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segmentItem, active && { backgroundColor: palette.ink }]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: active ? palette.onInk : palette.textSecondary, fontWeight: active ? '600' : '400' },
                    ]}
                  >
                    {t(`feedback.types.${item.value}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 问题描述：多行、必填、字数计数 */}
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: palette.textPrimary }]}>{t('feedback.content')}</Text>
            <Text style={[styles.required, { color: palette.danger }]}>*</Text>
          </View>
          <View style={[styles.textCard, { backgroundColor: palette.card }]}>
            <TextInput
              style={[styles.textArea, { color: palette.textPrimary }]}
              placeholder={t('feedback.placeholder', { count: FEEDBACK_CONTENT_MIN })}
              placeholderTextColor={palette.textTertiary}
              value={content}
              onChangeText={setContent}
              multiline
              maxLength={FEEDBACK_CONTENT_MAX}
              textAlignVertical="top"
              editable={!busy}
              scrollEnabled={false}
            />
            <Text style={[styles.counter, { color: palette.textTertiary }]}>
              {content.length}/{FEEDBACK_CONTENT_MAX}
            </Text>
          </View>

          {/* 图片：选填，最多 5 张，缩略图可删 */}
          <Text style={[styles.label, { color: palette.textPrimary }]}>
            {t('feedback.images', { count: FEEDBACK_IMAGE_MAX })}
          </Text>
          <View style={styles.imageGrid}>
            {images.map((img) => (
              <View key={img.uri} style={[styles.thumbWrap, { width: tileSize, height: tileSize }]}>
                <Image source={{ uri: img.uri }} style={[styles.thumb, { backgroundColor: palette.cardPill }]} />
                <Pressable
                  style={styles.thumbDelete}
                  onPress={() => onRemoveImage(img.uri)}
                  disabled={busy}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={t('feedback.deleteImage')}
                >
                  <SymbolView name="xmark" size={11} tintColor="#FFFFFF" weight="bold" />
                </Pressable>
              </View>
            ))}
            {remaining > 0 ? (
              <Pressable
                style={[
                  styles.addTile,
                  { width: tileSize, height: tileSize, borderColor: palette.separator, backgroundColor: palette.card },
                ]}
                onPress={onAddImages}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('feedback.addImage')}
              >
                <SymbolView name="plus" size={20} tintColor={palette.textTertiary} />
                <Text style={[styles.addTileText, { color: palette.textTertiary }]}>
                  {images.length}/{FEEDBACK_IMAGE_MAX}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* 可否被账号联系：默认开 */}
          <View style={[styles.toggleCard, { backgroundColor: palette.card }]}>
            <View style={styles.toggleTexts}>
              <Text style={[styles.toggleTitle, { color: palette.textPrimary }]}>{t('feedback.contact')}</Text>
              <Text style={[styles.toggleSub, { color: palette.textSecondary }]} numberOfLines={1}>
                {t('feedback.contactHint')}
              </Text>
            </View>
            <Switch
              value={contactOk}
              onValueChange={setContactOk}
              disabled={busy}
              trackColor={{ true: palette.success, false: palette.separator }}
            />
          </View>

          {/* 诊断信息：先说明会随反馈附带，再列出实际机型/系统/版本 */}
          <View style={styles.diag}>
            <View style={styles.diagRow}>
              <SymbolView name="info.circle" size={14} tintColor={palette.textTertiary} />
              <Text style={[styles.diagNote, { color: palette.textTertiary }]}>{t('feedback.diag')}</Text>
            </View>
            <Text style={[styles.diagDevice, { color: palette.textSecondary }]} numberOfLines={1}>
              {deviceSummary}
            </Text>
          </View>

          {/* 主按钮 */}
          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            style={[styles.primary, { backgroundColor: palette.ink, opacity: canSubmit ? 1 : 0.35 }]}
          >
            {busy ? (
              <ActivityIndicator color={palette.onInk} />
            ) : (
              <Text style={[styles.primaryText, { color: palette.onInk }]}>{t('feedback.submit')}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Space[4], gap: Space[3] },

  label: { fontSize: 15, fontWeight: '600', marginTop: Space[2] },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1], marginTop: Space[2] },
  required: { fontSize: 15, fontWeight: '600' },

  // 分段标签（iOS 分段控件观感：灰轨 + 主题墨色选中块）
  segment: { flexDirection: 'row', padding: Space[1], borderRadius: Radius.md },
  segmentItem: { flex: 1, height: 44, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 15 },

  // 多行描述卡
  textCard: { borderRadius: Radius.lg, paddingHorizontal: Space[4], paddingVertical: Space[3], minHeight: 132 },
  textArea: { fontSize: 16, lineHeight: 22, minHeight: 92, padding: 0 },
  counter: { alignSelf: 'flex-end', fontSize: 12, marginTop: Space[1], fontVariant: ['tabular-nums'] },

  // 图片网格（每行 5 格，单元格边长自适应，见组件内 tileSize）
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  thumbWrap: { position: 'relative' },
  thumb: { width: '100%', height: '100%', borderRadius: Radius.md },
  thumbDelete: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addTileText: { fontSize: 11, fontVariant: ['tabular-nums'] },

  // 联系开关卡
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[4],
    borderRadius: Radius.lg,
    paddingHorizontal: Space[4],
    paddingVertical: Space[4],
    marginTop: Space[2],
  },
  toggleTexts: { flex: 1, gap: Space[2] },
  toggleTitle: { fontSize: 16 },
  toggleSub: { fontSize: 12, lineHeight: 16 },

  // 诊断信息：机型行（图标与文字居中对齐）+ 说明行
  diag: { gap: Space[1], paddingHorizontal: Space[1], marginTop: Space[1] },
  diagRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  diagNote: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
  diagDevice: { fontSize: 13, fontWeight: '500', marginLeft: 14 + Space[2] },

  primary: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space[3],
  },
  primaryText: { fontSize: 17, fontWeight: '600' },
});
