/**
 * 本机外观偏好（PRD §18.3.4）：不属于家庭数据，也不需要跨设备同步。
 * React Native 的 Appearance 覆盖会驱动全局 useColorScheme，因此 RN 页面、
 * SwiftUI 原生控件和 expo-router 导航主题会在同一次选择后一起刷新。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { createContext, type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_PREFERENCE_KEY = 'homebook.theme-preference.v1';
const ThemePreferenceContext = createContext<{
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function applyThemePreference(preference: ThemePreference) {
  // `unspecified` removes the override and restores the device preference.
  if (typeof Appearance.setColorScheme === 'function') {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const hasUserChangedPreference = useRef(false);

  useEffect(() => {
    let active = true;

    const restorePreference = async () => {
      const stored = await AsyncStorage.getItem(THEME_PREFERENCE_KEY).catch(() => null);
      if (!active || hasUserChangedPreference.current || !isThemePreference(stored)) return;

      applyThemePreference(stored);
      setPreferenceState(stored);
    };

    void restorePreference();
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    hasUserChangedPreference.current = true;
    applyThemePreference(next);
    setPreferenceState(next);
    void AsyncStorage.setItem(THEME_PREFERENCE_KEY, next).catch(() => {});
  }, []);

  return <ThemePreferenceContext value={{ preference, setPreference }}>{children}</ThemePreferenceContext>;
}

export function useThemePreference() {
  const context = use(ThemePreferenceContext);
  if (!context) throw new Error('useThemePreference must be used within ThemePreferenceProvider');
  return context;
}
