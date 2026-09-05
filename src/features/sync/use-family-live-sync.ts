/**
 * 家庭在线协作同步：订 family_data_revisions 门铃 + 本人通知，并在回前台 / 重连时重拉。
 * Realtime 只负责失效缓存，读路径仍走现有 React Query。
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useMyFamily, useMyProfile } from '@/api';
import { useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

import { invalidateFamilyLiveQueries } from './family-live-queries';

const REALTIME_DEBOUNCE_MS = 300;

/** 仅在已登录树挂载，避免未登录时多打家庭查询。 */
export function FamilyLiveSyncHost() {
  useFamilyLiveSync();
  return null;
}

function useFamilyLiveSync() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const familyId = familyQ.data?.id ?? profileQ.data?.current_family_id ?? null;

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const scheduleInvalidate = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        void invalidateFamilyLiveQueries(queryClient);
      }, REALTIME_DEBOUNCE_MS);
    };

    const refreshNow = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      void invalidateFamilyLiveQueries(queryClient);
    };

    let sawSubscribe = false;
    const channelName = familyId ? `family-live:${familyId}` : `user-live:${userId}`;
    let channel = supabase.channel(channelName);

    if (familyId) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'family_data_revisions',
          filter: `family_id=eq.${familyId}`,
        },
        scheduleInvalidate,
      );
    }

    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      scheduleInvalidate,
    );

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (sawSubscribe) refreshNow();
        sawSubscribe = true;
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        sawSubscribe = true;
      }
    });

    let appState: AppStateStatus = AppState.currentState;
    const appSub = AppState.addEventListener('change', (next) => {
      const becameActive = appState !== 'active' && next === 'active';
      appState = next;
      if (becameActive) refreshNow();
    });

    return () => {
      appSub.remove();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, userId]);
}
