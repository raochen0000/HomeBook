export type AppLocale = 'zh' | 'en';

export const STORAGE_KEY = 'homebook.locale-preference.v1';

export const I18N_LANGUAGE = {
  zh: 'zh-Hans',
  en: 'en',
} as const;

export const INTL_LOCALE: Record<AppLocale, string> = {
  zh: 'zh-CN',
  en: 'en-US',
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === 'zh' || value === 'en';
}

/** 设备 languageCode：zh* → zh，其余 → en。 */
export function appLocaleFromDeviceLanguageCode(languageCode: string | null | undefined): AppLocale {
  if (languageCode && languageCode.toLowerCase().startsWith('zh')) return 'zh';
  return 'en';
}

export function toI18nLanguage(locale: AppLocale): 'zh-Hans' | 'en' {
  return I18N_LANGUAGE[locale];
}

export function fromI18nLanguage(language: string | undefined): AppLocale {
  if (language === 'en' || language?.startsWith('en')) return 'en';
  return 'zh';
}
