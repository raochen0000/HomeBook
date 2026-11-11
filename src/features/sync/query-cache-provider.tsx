import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { LaunchScreenOverlay } from '@/components/launch-screen';
import { usePalette } from '@/constants/design';
import { isLikelyNetworkError } from '@/features/record/save-attempt';
import { t, useLocalePreference } from '@/i18n';
import { useSession } from '@/lib/auth';
import { createQueryClient } from '@/lib/query-client';
import {
  isNetworkAvailable,
  reportNetworkTransportFailure,
  resumeFamilyQueries,
  subscribeFamilyVerification,
  suspendFamilyQueries,
} from '@/lib/query-network';
import { createQueryCacheSnapshot, restoreQueryCacheSnapshot } from '@/lib/query-cache-snapshot';
import {
  activateQueryCache,
  isQueryCacheBlocked,
  readQueryCache,
  removeQueryCache,
  writeQueryCache,
} from '@/lib/query-cache-storage';
import { supabase } from '@/lib/supabase';

type ClientState = { client: QueryClient; familyId: string | null; ready: boolean; generation: number };
const WRITE_DELAY_MS = 1_500;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function familyFromQuery(key: readonly unknown[], data: unknown): string | null | undefined {
  if (key[0] === 'family') {
    if (data === null) return null;
    return record(data) && typeof data.id === 'string' ? data.id : undefined;
  }
  if (key[0] === 'profile' && record(data)) {
    if (data.current_family_id === null) return null;
    return typeof data.current_family_id === 'string' ? data.current_family_id : undefined;
  }
  return undefined;
}

/** Wait for the current identity before restoring its encrypted data. */
export function QueryCacheProvider({ children }: { children: ReactNode }) {
  const { session, loading, unavailable, retry } = useSession();
  const palette = usePalette();
  useLocalePreference();
  const userId = session?.user.id ?? null;
  const lastUser = useRef<string | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      const previous = lastUser.current;
      if (previous && (event === 'SIGNED_OUT' || (next?.user.id && next.user.id !== previous))) {
        void removeQueryCache(previous).catch(() => {});
      }
      if (event === 'SIGNED_OUT') lastUser.current = null;
      else if (next?.user.id) {
        lastUser.current = next.user.id;
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') suspendFamilyQueries();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) lastUser.current = userId;
  }, [userId]);

  if (loading) return <LaunchScreenOverlay />;
  if (unavailable && !session) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.base, gap: 12 }}>
        <Text style={{ color: palette.textSecondary }}>{t('common.noCachedData')}</Text>
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text style={{ color: palette.accent }}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <QuerySession key={userId ?? 'signed-out'} userId={userId}>
      {children}
    </QuerySession>
  );
}

function QuerySession({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [state, setState] = useState<ClientState>(() => ({
    client: createQueryClient(),
    familyId: null,
    ready: !userId,
    generation: 0,
  }));

  useEffect(() => {
    if (!userId) return;
    activateQueryCache(userId);
    let active = true;
    void readQueryCache(userId)
      .then((snapshot) => {
        if (!active) return;
        if (snapshot) restoreQueryCacheSnapshot(state.client, snapshot);
        // Restored content is visible immediately, while mounted queries fetch a fresh copy.
        void state.client.invalidateQueries({ refetchType: 'none' });
        setState((current) => ({ ...current, familyId: snapshot?.familyId ?? null, ready: true }));
      })
      .catch(() => {
        if (active) setState((current) => ({ ...current, ready: true }));
      });
    return () => {
      active = false;
    };
    // A new account mounts a new QuerySession. A family change already starts with a fresh client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const client = state.client;
    if (!userId || !state.ready)
      return () => {
        void client.cancelQueries();
      };
    let active = true;
    let familyId = state.familyId;
    let profileVerified = false;
    let familyVerified = false;
    let gateOpen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const verifyIdentity = (online: boolean) => {
      if (!active || isQueryCacheBlocked(userId)) return;
      profileVerified = false;
      familyVerified = false;
      gateOpen = false;
      void client.cancelQueries({
        predicate: (query) => query.queryKey[0] !== 'profile' && query.queryKey[0] !== 'family',
      });
      if (online) {
        void client.invalidateQueries({ queryKey: ['profile'] });
        void client.invalidateQueries({ queryKey: ['family'] });
      }
    };
    const unsubscribeNetwork = subscribeFamilyVerification(verifyIdentity);

    const scheduleWrite = () => {
      if (!active || !familyId || isQueryCacheBlocked(userId)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (!active || !familyId || client.isMutating()) return;
        const profile = client.getQueryData(['profile']);
        const family = client.getQueryData(['family']);
        if (familyFromQuery(['profile'], profile) !== familyId || familyFromQuery(['family'], family) !== familyId)
          return;
        const snapshot = createQueryCacheSnapshot(client, userId, familyId);
        void writeQueryCache(snapshot).catch(() => {});
      }, WRITE_DELAY_MS);
    };

    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (!active || isQueryCacheBlocked(userId) || event.type !== 'updated') return;
      if (event.action.type === 'error') {
        if (isLikelyNetworkError(event.query.state.error)) reportNetworkTransportFailure();
        return;
      }
      if (event.action.type !== 'success') return;
      const nextFamily = familyFromQuery(event.query.queryKey, event.query.state.data);
      if (nextFamily !== undefined && familyId && nextFamily !== familyId) {
        // Replace the entire client instead of merely invalidating shared query keys.
        active = false;
        if (timer) clearTimeout(timer);
        suspendFamilyQueries();
        void client.cancelQueries();
        void removeQueryCache(userId).catch(() => {});
        activateQueryCache(userId);
        const nextClient = createQueryClient();
        if (nextFamily !== null) {
          nextClient.setQueryData(event.query.queryKey, event.query.state.data, {
            updatedAt: event.query.state.dataUpdatedAt,
          });
        }
        const preferences = client.getQueryData(['accounting_preferences']);
        if (preferences !== undefined) nextClient.setQueryData(['accounting_preferences'], preferences);
        setState((current) => ({
          client: nextClient,
          familyId: nextFamily,
          ready: true,
          generation: current.generation + 1,
        }));
        return;
      }
      if (nextFamily && !familyId) familyId = nextFamily;
      if (!event.action.manual && event.query.queryKey[0] === 'profile') profileVerified = true;
      if (!event.action.manual && event.query.queryKey[0] === 'family') familyVerified = true;
      if (
        !gateOpen &&
        profileVerified &&
        familyVerified &&
        familyFromQuery(['profile'], client.getQueryData(['profile'])) ===
          familyFromQuery(['family'], client.getQueryData(['family']))
      ) {
        gateOpen = true;
        resumeFamilyQueries();
        if (isNetworkAvailable()) {
          void client.refetchQueries(
            { type: 'active', predicate: (query) => query.state.status === 'error' },
            { cancelRefetch: false },
          );
        }
      }
      scheduleWrite();
    });
    const unsubscribeMutations = client.getMutationCache().subscribe(() => {
      if (!client.isMutating()) scheduleWrite();
    });
    suspendFamilyQueries();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      unsubscribeMutations();
      unsubscribeNetwork();
      suspendFamilyQueries();
      void client.cancelQueries();
    };
  }, [state.client, state.familyId, state.ready, userId]);

  if (!state.ready) return <LaunchScreenOverlay />;
  return (
    <QueryClientProvider key={state.generation} client={state.client}>
      {children}
    </QueryClientProvider>
  );
}
