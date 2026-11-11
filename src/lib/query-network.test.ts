import { onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { resumeFamilyQueries, subscribeFamilyVerification, suspendFamilyQueries } from './query-network';

const network = vi.hoisted(() => ({
  listener: (_state: { isConnected: boolean; isInternetReachable: boolean }) => {},
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    configure: vi.fn(),
    addEventListener: (listener: typeof network.listener) => {
      network.listener = listener;
      return () => {};
    },
  },
}));

describe('family query network gate', () => {
  it('pauses dependent queries until verification, including after reconnect', () => {
    const listener = vi.fn();
    const unsubscribeGate = subscribeFamilyVerification(listener);
    const unsubscribeOnline = onlineManager.subscribe(() => {});
    suspendFamilyQueries();
    expect(onlineManager.isOnline()).toBe(false);
    resumeFamilyQueries();
    expect(onlineManager.isOnline()).toBe(true);
    network.listener({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);
    network.listener({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(true);
    resumeFamilyQueries();
    expect(onlineManager.isOnline()).toBe(true);
    unsubscribeGate();
    unsubscribeOnline();
  });

  it('does not block connected devices when an unrelated reachability probe fails', () => {
    const unsubscribe = onlineManager.subscribe(() => {});
    resumeFamilyQueries();
    network.listener({ isConnected: true, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(true);
    unsubscribe();
  });

  it('keeps the previous result visible offline and refreshes it only after identity verification', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.mount();
    network.listener({ isConnected: false, isInternetReachable: false });
    client.setQueryData(['home_dashboard', 'current'], { total: 10 });
    const fetchDashboard = vi.fn(async () => ({ total: 20 }));
    const observer = new QueryObserver(client, {
      queryKey: ['home_dashboard', 'current'],
      queryFn: fetchDashboard,
    });
    const unsubscribe = observer.subscribe(() => {});

    expect(observer.getCurrentResult().data).toEqual({ total: 10 });
    expect(observer.getCurrentResult().fetchStatus).toBe('paused');
    expect(fetchDashboard).not.toHaveBeenCalled();
    network.listener({ isConnected: true, isInternetReachable: true });
    expect(fetchDashboard).not.toHaveBeenCalled();

    resumeFamilyQueries();
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual({ total: 20 }));
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    unsubscribe();
    client.unmount();
    client.clear();
  });
});
