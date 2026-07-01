/**
 * 把成员头像（远程 avatar_url）预下载到本地磁盘缓存，解析出本地 file:// 路径。
 *
 * 首页流水是 @expo/ui SwiftUI 原生渲染，原生 Image 的 `uiImage` 走同步本地读
 * （Data(contentsOf:)，会阻塞主线程）。直接喂远程 URL = 每行一次同步网络请求，必卡。
 * 因此先用 expo-image 预取到磁盘，再用本地路径喂给原生 Image：本地小文件同步读可忽略。
 */
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useState } from 'react';

type AvatarSource = { id: string; avatar_url: string | null };

export function useAvatarFiles(members: AvatarSource[]): Map<string, string> {
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  // 用稳定签名做依赖，避免 members 数组每次渲染换引用导致 effect 抖动。
  const signature = members.map((m) => `${m.id}:${m.avatar_url ?? ''}`).join('|');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const withUrl = members.filter((m) => m.avatar_url);
      if (withUrl.length === 0) {
        if (!cancelled) setFiles((prev) => (prev.size === 0 ? prev : new Map()));
        return;
      }
      const urls = withUrl.map((m) => m.avatar_url as string);
      await ExpoImage.prefetch(urls, 'memory-disk').catch(() => {});
      const entries = await Promise.all(
        withUrl.map(async (m) => {
          try {
            const path = await ExpoImage.getCachePathAsync(m.avatar_url as string);
            if (!path) return null;
            return [m.id, path.startsWith('file://') ? path : `file://${path}`] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setFiles(new Map(entries.filter((e): e is readonly [string, string] => e !== null)));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return files;
}
