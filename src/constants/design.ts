/**
 * 设计令牌（对齐 docs/DESIGN.md v0.6.3）。
 * 基调：黑白灰做骨架 + 系统蓝做交互（accent），iOS 设置式「灰底白卡」分区。
 * 收支语义色按 DESIGN §2.6：收入=红、支出=绿（中国大陆 红涨绿跌 惯例）。
 * 与既有 theme.ts（中性色 / Spacing）互补，这里补充语义色、分类识别色、排版、圆角与间距全刻度。
 */
import { useColorScheme } from 'react-native';

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  lgPlus: 20,
  xl: 28,
  full: 9999,
} as const;

/** 自定义排版 fallback（DESIGN §4）：奇数字号 / 行高向下取偶数，实际界面仍优先支持 Dynamic Type。 */
export const Typography = {
  largeTitle: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  subheadline: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  amountHero: { fontSize: 40, lineHeight: 48, fontWeight: '700' },
  amountRow: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
} as const;

/** 8pt 网格的紧凑刻度（DESIGN §6）：旧刻度整体 -2pt。 */
export const Space = {
  1: 2,
  2: 6,
  3: 10,
  4: 14,
  5: 18,
  6: 22,
  8: 30,
  10: 38,
  12: 46,
} as const;

/**
 * iOS 26 原生 NativeTabs 的悬浮 Tab Bar 半透明覆盖在内容之上（不会自动避让），
 * 因此可滚动页面的内容底部需预留此高度，最后一项才能滚到 Tab Bar 上方完整展示。
 * 取值≈悬浮条高度 + 底部安全区 + 余量，对齐首页 @expo/ui 列表的底部留白。
 */
export const TabBarInset = 120;

type Palette = {
  /** 收入：红 */
  income: string;
  /** 支出：绿 */
  expense: string;
  warning: string;
  danger: string;
  info: string;
  /** 成功：绿（DESIGN §2.7 state/success）。与 expense 同色值，但语义独立——成功提示的绿勾不应复用「支出绿」令牌。 */
  success: string;
  /** 页面底 */
  base: string;
  /** 卡片底 */
  card: string;
  /** 浮层 / 分组 */
  elevated: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  /** 强调 / 交互色（系统蓝）：app 内主 CTA / FAB / 选中态 / 进度常态（DESIGN §2.5） */
  accent: string;
  onAccent: string;
  /**
   * 墨色：**全局**「用户的确认 / 主操作」色（v0.6.5 起，不再限登录 surface）。用于：主 CTA 实底、
   * ➕ 记一笔 FAB 实底、Sheet 顶部的确认文字动作（完成 / 保存 / 应用 / 获取验证码，加粗）、
   * 勾选态、滑动确认。蓝（accent）退回「跳转 / 链接 + 系统交互」——可点文字与链接、列表选中态、
   * 开关 on、进度、聚焦框——不再做按钮实底。见 DESIGN §2.5 / §9.5。
   *
   * 组织原则：**墨 = 你的确认动作，蓝 = 跳转 / 链接，红 = 破坏**。
   *
   * 随主题反相（浅色近黑 / 深色近白），所以永远和所在表面拉开对比；写死的 hex 做不到这点，
   * 旧登录页正是写死 #1C1C1E 撞上 dark.card 才整个消失。
   * 深色取 #F5F5F7 而非纯白：大面积纯白在深色下会光晕（halation）。
   */
  ink: string;
  onInk: string;
  /** 信息条幅 / 徽标底（中性 systemFill，DESIGN v0.5.0 去暖色） */
  bannerTint: string;
  shadow: string;
  /** 卡内胶囊（周期选择器）底色（中性 systemFill） */
  cardPill: string;
};

/**
 * iOS 设置式「浅灰底 + 白卡」分区（DESIGN §2.3，Light 基调灰 #F2F1F5）。
 * accent = 系统蓝 #007AFF（DESIGN §2.5）；onAccent = 蓝底上的白。
 */
const light: Palette = {
  income: '#E2563D',
  expense: '#2FA36B',
  warning: '#F5A623',
  danger: '#E2563D',
  info: '#007AFF',
  success: '#2FA36B',
  base: '#F2F1F5',
  card: '#FFFFFF',
  elevated: '#F2F1F5',
  textPrimary: '#1C1C1E',
  textSecondary: 'rgba(60,60,67,0.6)',
  textTertiary: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.18)',
  accent: '#007AFF',
  onAccent: '#FFFFFF',
  ink: '#1C1C1E',
  onInk: '#FFFFFF',
  bannerTint: 'rgba(120,120,128,0.12)',
  shadow: 'rgba(0,0,0,0.06)',
  cardPill: 'rgba(120,120,128,0.12)',
};

const dark: Palette = {
  income: '#FF7461',
  expense: '#46C98A',
  warning: '#FFB84D',
  danger: '#FF7461',
  info: '#0A84FF',
  success: '#46C98A',
  base: '#000000',
  card: '#1C1C1E',
  elevated: '#2C2C2E',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(235,235,245,0.6)',
  textTertiary: 'rgba(235,235,245,0.3)',
  separator: 'rgba(84,84,88,0.6)',
  accent: '#0A84FF',
  onAccent: '#FFFFFF',
  ink: '#F5F5F7',
  onInk: '#1C1C1E',
  bannerTint: 'rgba(120,120,128,0.24)',
  shadow: 'rgba(0,0,0,0.4)',
  cardPill: 'rgba(255,255,255,0.12)',
};

/** 分类识别色（DESIGN §2.8），按主题取值。 */
export const CategoryColors = {
  light: {
    food: '#F4B183',
    transit: '#8FB7E0',
    shopping: '#E6A0B8',
    home: '#A8C8A0',
    entertainment: '#C9A7E0',
    medical: '#9AB0E0',
    education: '#7FC2C2',
    social: '#E6A0B8',
    saving: '#C7B299',
    incomeGeneric: '#8FBF9F',
    other: '#C7C7CC',
  },
  dark: {
    food: '#C77E4F',
    transit: '#5E84AD',
    shopping: '#B36E86',
    home: '#74976E',
    entertainment: '#9472AD',
    medical: '#6A80AD',
    education: '#558F8F',
    social: '#B36E86',
    saving: '#94806A',
    incomeGeneric: '#5F8F6F',
    other: '#8E8E93',
  },
} as const;

export type CategoryColorKey = keyof typeof CategoryColors.light;

export function usePalette(): Palette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

export function useCategoryColors() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? CategoryColors.dark : CategoryColors.light;
}

/**
 * 成员头像回退色块底色（无头像时的首字母 / person.fill 图标底）。4 色循环，按 id 稳定取色。
 *
 * DESIGN §3.0：
 * - 铁律 4——Light / Night 各自取值，不共用同一 hex。
 * - 铁律 3 /§1.2「红绿只在收支」——避开红 / 绿 / 琥珀语义色。旧值里 `#46C98A` 恰为
 *   `dark.expense`、`#F5A623` 恰为 `light.warning`，头像撞成「支出绿 / 预警琥珀」，已换成
 *   teal / pink（槽位不变，老用户的回退色仍落在同一 hash 槽，只是换了非语义色相）。
 * 圆底其上的图标 / 文字恒为 `#FFFFFF`（§2.8 豁免，不随主题翻转）。
 */
export const AvatarTints = {
  light: ['#5AA7F0', '#33B0A5', '#E28CAE', '#9B6DD6'],
  dark: ['#6FB4F2', '#4CC3B7', '#EDA3C0', '#AD85E0'],
} as const;

export function useAvatarTints(): readonly string[] {
  const scheme = useColorScheme();
  return scheme === 'dark' ? AvatarTints.dark : AvatarTints.light;
}

/** 按 id 稳定映射到一个头像回退色。`tints` 传 `useAvatarTints()` 的结果（保证随主题走）。 */
export function avatarTintFor(id: string, tints: readonly string[]): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return tints[h % tints.length];
}
