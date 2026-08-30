/**
 * 本机界面语言（PRD §18.3.5）：个人级、不跨设备、对齐深色模式。
 * 无存档时：设备 languageCode 以 zh 开头 → zh，否则 → en。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react';

import { setAppLocale } from './instance';
import { type AppLocale, STORAGE_KEY, appLocaleFromDeviceLanguageCode, isAppLocale } from './locale';

const LocalePreferenceContext = createContext<{
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
} | null>(null);

/** 切语言前记录路由，供重建导航壳后还原当前位置。 */
export const localePathRef = { current: '/' };
export const pendingLocaleRestoreRef = { current: null as string | null };

function deviceDefaultLocale(): AppLocale {
  try {
    return appLocaleFromDeviceLanguageCode(getLocales()[0]?.languageCode);
  } catch {
    return 'zh';
  }
}

export function LocalePreferenceProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    const next = deviceDefaultLocale();
    setAppLocale(next);
    return next;
  });
  const hasUserChanged = useRef(false);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
      if (!active || hasUserChanged.current) return;
      const next = isAppLocale(stored) ? stored : deviceDefaultLocale();
      setAppLocale(next);
      setLocaleState(next);
    };
    void restore();
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(
    (next: AppLocale) => {
      if (next === locale) return;
      hasUserChanged.current = true;
      pendingLocaleRestoreRef.current = localePathRef.current;
      setAppLocale(next);
      setLocaleState(next);
      void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    },
    [locale],
  );

  return <LocalePreferenceContext value={{ locale, setLocale }}>{children}</LocalePreferenceContext>;
}

export function useLocalePreference() {
  const context = use(LocalePreferenceContext);
  if (!context) throw new Error('useLocalePreference must be used within LocalePreferenceProvider');
  return context;
}
