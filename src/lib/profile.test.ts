import { describe, expect, it } from 'vitest';

import {
  NICKNAME_MAX_WIDTH,
  avatarInitialFromNickname,
  limitNicknameDraft,
  nicknameWidth,
  normalizeDefaultNickname,
  validateNickname,
} from './profile';

describe('nickname width', () => {
  it('counts ASCII as 1 and other characters as 2', () => {
    expect(nicknameWidth('爸爸')).toBe(4);
    expect(nicknameWidth('Christopher')).toBe(11);
    expect(nicknameWidth('Elizabeth Chen')).toBe(14);
    expect(nicknameWidth('一二三四五六七八九十')).toBe(20);
    expect(nicknameWidth('李Christopher')).toBe(13);
  });

  it('accepts a full Chinese name and a normal English name, and rejects anything wider', () => {
    expect(validateNickname('一二三四五六七八九十')).toBeNull();
    expect(validateNickname('Elizabeth Chen')).toBeNull();
    expect(validateNickname('Christopher Alexander')).toBe(validateNickname(''));
    expect(validateNickname('   ')).not.toBeNull();
    expect(nicknameWidth('Christopher Alexander')).toBe(21);
  });

  it('cuts a draft on the width boundary without splitting a character', () => {
    expect(limitNicknameDraft('Christopher Alexander')).toBe('Christopher Alexande');
    expect(nicknameWidth(limitNicknameDraft('Christopher Alexander'))).toBe(NICKNAME_MAX_WIDTH);
    expect(limitNicknameDraft('一二三四五六七八九十多')).toBe('一二三四五六七八九十');
    expect(limitNicknameDraft('Elizabeth Chen')).toBe('Elizabeth Chen');
  });

  it('uses the last visible character for the avatar fallback', () => {
    expect(avatarInitialFromNickname('Elizabeth')).toBe('h');
    expect(avatarInitialFromNickname('小美')).toBe('美');
    expect(avatarInitialFromNickname('   ')).toBe('?');
  });

  it('falls back when a provided default name is blank', () => {
    expect(normalizeDefaultNickname('   ')).toBe('用户');
    expect(normalizeDefaultNickname('Christopher Alexander')).toBe('Christopher Alexande');
    expect(normalizeDefaultNickname('小美')).toBe('小美');
  });
});
