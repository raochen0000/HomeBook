/**
 * 设计令牌（对齐 docs/DESIGN.md v0.4.0）。
 * 收支语义色按 DESIGN §4.2.2：收入=红、支出=绿（中国大陆 红涨绿跌 惯例）。
 * 与既有 theme.ts（中性色 / Spacing）互补，这里补充语义色、分类识别色、圆角与间距全刻度。
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

/** 8pt 网格全刻度（DESIGN §6）。 */
export const Space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
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
  /** 强调（主 CTA / FAB） */
  accent: string;
  onAccent: string;
  /** 信息条幅暖底 */
  bannerTint: string;
  shadow: string;
  /** 卡内胶囊（周期选择器）底色（中性 systemFill） */
  cardPill: string;
};

/**
 * 参考图为「浅灰底 + 白卡」（贴近 iOS grouped 观感）。
 * 这与 DESIGN §4.2.3 v0.4.0 的「白底 + 浅灰卡」相反——此处按用户提供的参考图取「灰底白卡」。
 */
const light: Palette = {
  income: '#E2563D',
  expense: '#2FA36B',
  warning: '#F5A623',
  danger: '#E2563D',
  info: '#4A90D9',
  base: '#F2F2F7',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  textPrimary: '#1C1C1E',
  textSecondary: 'rgba(60,60,67,0.6)',
  textTertiary: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.18)',
  accent: '#1C1C1E',
  onAccent: '#FFFFFF',
  bannerTint: '#FBE6D4',
  shadow: 'rgba(0,0,0,0.06)',
  cardPill: 'rgba(120,120,128,0.12)',
};

const dark: Palette = {
  income: '#FF7461',
  expense: '#46C98A',
  warning: '#FFB84D',
  danger: '#FF7461',
  info: '#5AA7F0',
  base: '#000000',
  card: '#1C1C1E',
  elevated: '#2C2C2E',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(235,235,245,0.6)',
  textTertiary: 'rgba(235,235,245,0.3)',
  separator: 'rgba(84,84,88,0.6)',
  accent: '#F2F2F7',
  onAccent: '#1C1C1E',
  bannerTint: '#2E2820',
  shadow: 'rgba(0,0,0,0.4)',
  cardPill: 'rgba(255,255,255,0.12)',
};

/** 分类识别色（DESIGN §9.1），按主题取值。 */
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
