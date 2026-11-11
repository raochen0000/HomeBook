import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

let connected = true;
let familyVerified = false;
const listeners = new Set<(online: boolean) => void>();

export function isNetworkAvailable(): boolean {
  return connected;
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

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    const next = state.isConnected !== false && state.isInternetReachable !== false;
    if (next !== connected) {
      connected = next;
      familyVerified = false;
      setOnline(false);
      for (const listener of listeners) listener(next);
    } else {
      setOnline(connected && familyVerified);
    }
  }),
);
onlineManager.setOnline(false);
