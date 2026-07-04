/**
 * 搜索入口（流程 14）：各 Tab 顶栏 🔍 跳转到独立搜索路由。
 */
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { usePalette } from '@/constants/design';

type SearchContextValue = { openSearch: () => void };

const SearchCtx = createContext<SearchContextValue>({ openSearch: () => {} });

export function useSearch() {
  return useContext(SearchCtx);
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const value = useMemo(() => ({ openSearch: () => router.push('/search') }), [router]);
  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
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
