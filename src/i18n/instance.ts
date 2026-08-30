import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { type AppLocale, toI18nLanguage } from './locale';
import en from './resources/en';
import zhHans from './resources/zh-Hans';

type DeepString<T> = T extends string ? string : { [K in keyof T]: DeepString<T[K]> };
const _en: DeepString<typeof zhHans> = en;
void _en;

// i18next 的默认导出就是运行时实例；named export 与实例方法同名，lint 会误报。
/* eslint-disable import/no-named-as-default-member */
void i18n.use(initReactI18next).init({
  resources: {
    'zh-Hans': { translation: zhHans },
    en: { translation: en },
  },
  lng: 'zh-Hans',
  fallbackLng: 'zh-Hans',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

/** 系统 Alert 默认「好」跟设备语言走；显式传 OK，才跟 App 界面语言一致。 */
export function alertOk(): { text: string }[] {
  return [{ text: t('common.ok') }];
}

export function setAppLocale(locale: AppLocale): void {
  void i18n.changeLanguage(toI18nLanguage(locale));
}

export { i18n };
/* eslint-enable import/no-named-as-default-member */
