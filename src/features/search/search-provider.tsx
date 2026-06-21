/**
 * 搜索单例（流程 14）：根布局挂一个全屏搜索页 + 暴露 openSearch()，
 * 各 Tab 顶栏 🔍 共用同一实例，避免每个页面各持一份 state。
 * 形态为全屏 Modal 覆盖层（与记账 / 邀请等二级页一致），满足 PRD「独立全屏、非半屏抽屉」。
 */
import { SymbolView } from 'expo-symbols';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { usePalette } from '@/constants/design';

import { SearchSheet } from './search-sheet';

type SearchContextValue = { openSearch: () => void };

const SearchCtx = createContext<SearchContextValue>({ openSearch: () => {} });

export function useSearch() {
  return useContext(SearchCtx);
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ openSearch: () => setOpen(true) }), []);
  return (
    <SearchCtx.Provider value={value}>
      {children}
      <SearchSheet visible={open} onClose={() => setOpen(false)} />
    </SearchCtx.Provider>
  );
}

/** 各 Tab 顶栏右上角 🔍（流程 14 入口；「我的」页除外）。 */
export function HeaderSearchButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  const { openSearch } = useSearch();
  return (
    <Pressable hitSlop={12} onPress={openSearch} style={style}>
      <SymbolView name="magnifyingglass" tintColor={palette.textPrimary} size={22} />
    </Pressable>
  );
}
