/**
 * 搜索历史（流程 14 / PRD §16.3）：本地保留最近若干条关键词，
 * 支持点击回填、单条删除、一键清空。存于 AsyncStorage，跨重启保留、仅本机。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'search.history.v1';
const MAX = 10;

export function useSearchHistory() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => {
      if (!raw) return;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setItems(arr.filter((x): x is string => typeof x === 'string').slice(0, MAX));
        }
      } catch {
        // 损坏数据忽略
      }
    });
  }, []);

  const save = useCallback((next: string[]) => {
    setItems(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /** 记录一条关键词：去重后置顶，超出上限截断。 */
  const push = useCallback((kw: string) => {
    const k = kw.trim();
    if (k === '') return;
    setItems((prev) => {
      const next = [k, ...prev.filter((x) => x !== k)].slice(0, MAX);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const remove = useCallback((kw: string) => {
    setItems((prev) => {
      const next = prev.filter((x) => x !== kw);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clear = useCallback(() => save([]), [save]);

  return { items, push, remove, clear };
}
