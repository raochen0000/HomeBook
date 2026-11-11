import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateQueryCache, readQueryCache, removeQueryCache, writeQueryCache } from './query-cache-storage';

const storage = vi.hoisted(() => ({
  cache: new Map<string, string>(),
  keys: new Map<string, string>(),
  encryptStarted: undefined as (() => void) | undefined,
  releaseEncrypt: undefined as (() => void) | undefined,
  pauseEncrypt: false,
  pauseDecrypt: false,
  decryptStarted: undefined as (() => void) | undefined,
  releaseDecrypt: undefined as (() => void) | undefined,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./supabase', () => ({ supabaseAuthStorageKey: 'sb-testproject-auth-token' }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.cache.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.cache.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.cache.delete(key);
    },
  },
}));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => storage.keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    storage.keys.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    storage.keys.delete(key);
  },
}));
vi.mock('expo-crypto', () => ({
  AESEncryptionKey: {
    generate: async () => ({ encoded: async () => '1234' }),
    import: async () => ({ encoded: async () => '1234' }),
  },
  AESSealedData: { fromCombined: (encrypted: string) => encrypted },
  aesEncryptAsync: async (bytes: Uint8Array) => {
    if (storage.pauseEncrypt) {
      storage.encryptStarted?.();
      await new Promise<void>((resolve) => {
        storage.releaseEncrypt = resolve;
      });
    }
    return { combined: async () => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')) };
  },
  aesDecryptAsync: async (encoded: string) => {
    if (storage.pauseDecrypt) {
      storage.decryptStarted?.();
      await new Promise<void>((resolve) => {
        storage.releaseDecrypt = resolve;
      });
    }
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  },
}));

beforeEach(() => {
  storage.cache.clear();
  storage.keys.clear();
  storage.pauseEncrypt = false;
  storage.pauseDecrypt = false;
  storage.encryptStarted = undefined;
  storage.releaseEncrypt = undefined;
  storage.decryptStarted = undefined;
  storage.releaseDecrypt = undefined;
});

describe('encrypted cache lifecycle', () => {
  const snapshot = {
    version: 1 as const,
    userId: 'user-1',
    familyId: 'family-1',
    queries: [{ key: ['family'], data: { id: 'family-1', name: 'private' }, updatedAt: 1 }],
  };

  it('restores only the matching account and deletes the key and cached data on sign-out', async () => {
    activateQueryCache('user-1');
    await writeQueryCache(snapshot);
    expect([...storage.cache.keys()][0]).toContain('sb-testproject');
    expect([...storage.cache.keys()][0]).not.toContain('-auth-token');
    expect(await readQueryCache('user-1')).toEqual(snapshot);
    expect(await readQueryCache('user-2')).toBeNull();
    await removeQueryCache('user-1');
    expect(storage.cache.size).toBe(0);
    expect(storage.keys.size).toBe(0);
  });

  it('cannot resurrect data when sign-out happens during encryption', async () => {
    activateQueryCache('user-1');
    storage.pauseEncrypt = true;
    const started = new Promise<void>((resolve) => {
      storage.encryptStarted = resolve;
    });
    const pendingWrite = writeQueryCache(snapshot);
    await started;
    const removal = removeQueryCache('user-1');
    storage.releaseEncrypt?.();
    await Promise.all([pendingWrite, removal]);
    await writeQueryCache(snapshot);
    expect(storage.cache.size).toBe(0);
    expect(storage.keys.size).toBe(0);
    activateQueryCache('user-1');
    storage.pauseEncrypt = false;
    await writeQueryCache(snapshot);
    expect(await readQueryCache('user-1')).toEqual(snapshot);
  });

  it('discards a restore that finishes after sign-out', async () => {
    activateQueryCache('user-1');
    await writeQueryCache(snapshot);
    storage.pauseDecrypt = true;
    const started = new Promise<void>((resolve) => {
      storage.decryptStarted = resolve;
    });
    const pendingRead = readQueryCache('user-1');
    await started;
    const removal = removeQueryCache('user-1');
    storage.releaseDecrypt?.();
    expect(await pendingRead).toBeNull();
    await removal;
  });
});
