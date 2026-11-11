import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { createOfflineRecovery } from './offline-recovery';

let connected = true;
let lastReconnectedAt = 0;
let familyVerified = false;
const listeners = new Set<(online: boolean) => void>();
const availabilityListeners = new Set<() => void>();
let lastNativeConnected: boolean | null = null;
let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

// The default Google reachability probe can be blocked while our backend remains reachable.
// Use device connectivity as a hint and let the actual service requests report failures.
NetInfo.configure({ reachabilityShouldRun: () => false });

export function isNetworkAvailable(): boolean {
  return connected;
}

export function getLastNetworkReconnectAt(): number {
  return lastReconnectedAt;
}

export function subscribeNetworkAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener);
  // Keep the native listener alive even if authentication failed before QueryClient mounted.
  const unsubscribeOnline = onlineManager.subscribe(() => {});
  return () => {
    availabilityListeners.delete(listener);
    unsubscribeOnline();
  };
}

export function useNetworkAvailable(): boolean {
  return useSyncExternalStore(subscribeNetworkAvailability, isNetworkAvailable, isNetworkAvailable);
}

function updateConnectivity(next: boolean): void {
  if (next === connected) return;
  connected = next;
  if (next) lastReconnectedAt = Date.now();
  familyVerified = false;
  onlineManager.setOnline(false);
  for (const listener of listeners) listener(next);
  for (const listener of availabilityListeners) listener();
}

const recovery = createOfflineRecovery({
  isForeground: () => foreground,
  check: async (signal) => {
    const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!base) return false;
    // A response (including 401 without an API key) proves the app's own service is reachable.
    await fetch(new URL('/rest/v1/', base).toString(), { method: 'HEAD', signal, credentials: 'omit' });
    return true;
  },
  onRecovered: () => updateConnectivity(true),
});

/** Retry promptly on a user action instead of waiting for the offline backoff. */
export async function requestNetworkRecovery(): Promise<boolean> {
  if (connected) return true;
  return (await recovery.retryNow()) || connected;
}

/** A stale simulator callback must not keep a previously recovered network online forever. */
export function reportNetworkTransportFailure(): void {
  if (lastNativeConnected !== false || !connected) return;
  updateConnectivity(false);
  // Avoid a tight recovery loop when the health endpoint responds but real requests fail.
  recovery.startDelayed();
}

/** Family-dependent queries wait until the identity reads have confirmed the active family. */
export function suspendFamilyQueries(): void {
  familyVerified = false;
  onlineManager.setOnline(false);
  for (const listener of listeners) listener(connected);
}

export function resumeFamilyQueries(): void {
  familyVerified = true;
  onlineManager.setOnline(connected);
}

export function subscribeFamilyVerification(listener: (online: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

onlineManager.setEventListener((setOnline) => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const next = state.isConnected;
    if (next !== null && next !== lastNativeConnected) {
      lastNativeConnected = next;
      if (next) recovery.stop();
      updateConnectivity(next);
    }
    if (!connected) recovery.start();
    setOnline(connected && familyVerified);
  });
  const appState = AppState.addEventListener('change', (state) => {
    foreground = state === 'active';
    if (!foreground) recovery.stop();
    else {
      void NetInfo.refresh().catch(() => {});
      if (!connected) recovery.retryNow();
    }
  });
  return () => {
    unsubscribe();
    appState.remove();
    recovery.stop();
  };
});
onlineManager.setOnline(false);
