import { afterEach, describe, expect, it } from 'vitest';

import { setAppLocale, t } from './instance';
import { appLocaleFromDeviceLanguageCode, fromI18nLanguage, toI18nLanguage } from './locale';

describe('appLocaleFromDeviceLanguageCode', () => {
  it('maps zh* to zh', () => {
    expect(appLocaleFromDeviceLanguageCode('zh')).toBe('zh');
    expect(appLocaleFromDeviceLanguageCode('zh-Hans')).toBe('zh');
    expect(appLocaleFromDeviceLanguageCode('zh-CN')).toBe('zh');
    expect(appLocaleFromDeviceLanguageCode('ZH-Hant')).toBe('zh');
  });

  it('maps anything else to en', () => {
    expect(appLocaleFromDeviceLanguageCode('en')).toBe('en');
    expect(appLocaleFromDeviceLanguageCode('en-US')).toBe('en');
    expect(appLocaleFromDeviceLanguageCode('ja')).toBe('en');
    expect(appLocaleFromDeviceLanguageCode(null)).toBe('en');
    expect(appLocaleFromDeviceLanguageCode(undefined)).toBe('en');
    expect(appLocaleFromDeviceLanguageCode('')).toBe('en');
  });
});

describe('i18n language mapping', () => {
  it('maps short codes to i18next languages', () => {
    expect(toI18nLanguage('zh')).toBe('zh-Hans');
    expect(toI18nLanguage('en')).toBe('en');
  });

  it('maps i18next languages back to short codes', () => {
    expect(fromI18nLanguage('zh-Hans')).toBe('zh');
    expect(fromI18nLanguage('en')).toBe('en');
    expect(fromI18nLanguage('en-US')).toBe('en');
    expect(fromI18nLanguage(undefined)).toBe('zh');
  });
});

describe('family.moreGoals plural', () => {
  afterEach(() => setAppLocale('zh'));

  it('uses singular English when count is 1', () => {
    setAppLocale('en');
    expect(t('family.moreGoals', { count: 1 })).toBe(' · 1 more goal');
    expect(t('family.moreGoals', { count: 2 })).toBe(' · 2 more goals');
  });
});
