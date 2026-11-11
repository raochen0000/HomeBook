import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseQueryCacheSnapshot, type QueryCacheSnapshot } from './query-cache-snapshot';
import { supabaseAuthStorageKey } from './supabase';

const epochs = new Map<string, number>();
const blockedUsers = new Set<string>();
let operations: Promise<void> = Promise.resolve();

function cacheKey(userId: string): string {
  return `homebook.query-cache.v2.${supabaseAuthStorageKey.replace(/-auth-token$/, '')}.${userId}`;
}

function keyName(userId: string): string {
  return `homebook.query-key.v2.${supabaseAuthStorageKey.replace(/-auth-token$/, '')}.${userId}`;
}

/** Serialize writes and deletions so a delayed write cannot resurrect a signed-out user's data. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const next = operations.then(task, task);
  operations = next.catch(() => {});
  return next;
}

async function readKey(userId: string): Promise<AESEncryptionKey | null> {
  const encoded = await SecureStore.getItemAsync(keyName(userId));
  return encoded ? AESEncryptionKey.import(encoded, 'hex') : null;
}

async function getOrCreateKey(userId: string): Promise<AESEncryptionKey> {
  const existing = await readKey(userId);
  if (existing) return existing;
  const key = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(keyName(userId), await key.encoded('hex'), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
}

export async function readQueryCache(userId: string): Promise<QueryCacheSnapshot | null> {
  if (Platform.OS === 'web') return null;
  const epoch = epochs.get(userId) ?? 0;
  await operations;
  if (blockedUsers.has(userId) || (epochs.get(userId) ?? 0) !== epoch) return null;
  try {
    const [encrypted, key] = await Promise.all([AsyncStorage.getItem(cacheKey(userId)), readKey(userId)]);
    if (!encrypted || !key) {
      // Development builds before project scoping used a different key; never reuse that data.
      void Promise.allSettled([
        AsyncStorage.removeItem(`homebook.query-cache.v1.${userId}`),
        SecureStore.deleteItemAsync(`homebook.query-key.v1.${userId}`),
      ]);
      return null;
    }
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(encrypted), key);
    if (blockedUsers.has(userId) || (epochs.get(userId) ?? 0) !== epoch) return null;
    return parseQueryCacheSnapshot(new TextDecoder().decode(bytes), userId);
  } catch {
    // A missing key, damaged cache or unavailable storage must never block startup.
    return null;
  }
}

export function writeQueryCache(snapshot: QueryCacheSnapshot): Promise<void> {
  if (Platform.OS === 'web' || blockedUsers.has(snapshot.userId)) return Promise.resolve();
  const epoch = epochs.get(snapshot.userId) ?? 0;
  return enqueue(async () => {
    if (blockedUsers.has(snapshot.userId) || (epochs.get(snapshot.userId) ?? 0) !== epoch) return;
    const key = await getOrCreateKey(snapshot.userId);
    const encrypted = await aesEncryptAsync(new TextEncoder().encode(JSON.stringify(snapshot)), key);
    if (blockedUsers.has(snapshot.userId) || (epochs.get(snapshot.userId) ?? 0) !== epoch) return;
    await AsyncStorage.setItem(cacheKey(snapshot.userId), await encrypted.combined('base64'));
  });
}

export function removeQueryCache(userId: string): Promise<void> {
  blockedUsers.add(userId);
  epochs.set(userId, (epochs.get(userId) ?? 0) + 1);
  if (Platform.OS === 'web') return Promise.resolve();
  return enqueue(async () => {
    const results = await Promise.allSettled([
      AsyncStorage.removeItem(cacheKey(userId)),
      SecureStore.deleteItemAsync(keyName(userId)),
      AsyncStorage.removeItem(`homebook.query-cache.v1.${userId}`),
      SecureStore.deleteItemAsync(`homebook.query-key.v1.${userId}`),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  });
}

/** A new account/family client may write again only after its former scope has been retired. */
export function activateQueryCache(userId: string): void {
  blockedUsers.delete(userId);
}

export function isQueryCacheBlocked(userId: string): boolean {
  return blockedUsers.has(userId);
}
