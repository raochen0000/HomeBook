/**
 * 登录身份的进程内缓存。
 * `linkIdentity` / `unlinkIdentity` 不会稳定更新 `useSession()` 拿到的 `session.user.identities`，
 * 账号页若继续读那份快照，从 Apple 管理页返回后会停在进入前的「未连接」。
 * 每次向 Auth 读取身份都记在这里，并丢弃后返回的旧请求，避免慢响应盖掉刚绑定的结果。
 */

export type LoginIdentity = {
  provider: string;
};

export type LoginIdentitySnapshot = {
  userId: string;
  identities: readonly LoginIdentity[];
};

type Listener = () => void;

let readSeq = 0;
let memory: { userId: string; identities: readonly LoginIdentity[] } | null = null;
const listeners = new Set<Listener>();

/** 开始一次身份读取。只有序号仍是最新的那次结果可以写入缓存。 */
export function beginLoginIdentityRead(): number {
  readSeq += 1;
  return readSeq;
}

export function rememberLoginIdentities(
  seq: number,
  userId: string | undefined,
  identities: readonly LoginIdentity[],
): boolean {
  if (!userId || seq !== readSeq) return false;
  memory = { userId, identities: identities.slice() };
  listeners.forEach((listener) => listener());
  return true;
}

export function peekLoginIdentities(userId: string | undefined): readonly LoginIdentity[] | null {
  if (!userId || memory?.userId !== userId) return null;
  return memory.identities;
}

export function subscribeLoginIdentities(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 同一用户已复核过的身份优先于 session 快照；换账号后不再沿用上一份。 */
export function loginIdentitiesForAccount(
  userId: string | undefined,
  sessionIdentities: readonly LoginIdentity[] | null | undefined,
  snapshot: LoginIdentitySnapshot | null,
): readonly LoginIdentity[] {
  if (userId && snapshot?.userId === userId) return snapshot.identities;
  return sessionIdentities ?? [];
}

/** 测试隔离用，清掉序号、缓存和订阅。 */
export function resetLoginIdentityCache(): void {
  readSeq = 0;
  memory = null;
  listeners.clear();
}
