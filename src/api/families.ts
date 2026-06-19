/** 家庭 / profile 数据访问 + 家庭相关 RPC（创建、邀请、加入）。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Profile = Tables<'profiles'>;
export type Family = Tables<'families'>;
export type Invitation = Tables<'invitations'>;

/** 当前登录用户的 profile；未登录返回 null。 */
export async function fetchMyProfile(): Promise<Profile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;
  // 必须按自己过滤：profiles 的 RLS 是「自己或同家庭成员」，多人家庭下 select('*') 会返回多行，
  // .single() 遇多行会报错。显式 .eq('id', 自己) 才能稳定只取本人这一行。
  const { data, error } = await supabase.from('profiles').select('*').eq('id', sessionData.session.user.id).single();
  if (error) throw error;
  return data;
}

export function useMyProfile() {
  return useQuery({ queryKey: queryKeys.profile, queryFn: fetchMyProfile });
}

export type FamilyMember = Pick<Profile, 'id' | 'nickname' | 'avatar_url'>;

/** 同家庭成员（含自己）的昵称/头像；RLS（shares_family）只返回同家庭成员。 */
export async function fetchFamilyMembers(): Promise<FamilyMember[]> {
  const { data, error } = await supabase.from('profiles').select('id, nickname, avatar_url');
  if (error) throw error;
  return data;
}

export function useFamilyMembers() {
  return useQuery({ queryKey: queryKeys.familyMembers, queryFn: fetchFamilyMembers });
}

/** 家庭成员（含身份 owner/member）。memberships 与 profiles 分开取后在 JS 合并（生成类型未含外键嵌入）。 */
export type FamilyMembership = {
  /** membership id */
  id: string;
  userId: string;
  role: 'owner' | 'member';
  nickname: string;
  avatarUrl: string | null;
};

export async function fetchMemberships(): Promise<FamilyMembership[]> {
  const [memRes, profRes] = await Promise.all([
    supabase.from('memberships').select('id, user_id, role, joined_at').eq('status', 'active'),
    supabase.from('profiles').select('id, nickname, avatar_url'),
  ]);
  if (memRes.error) throw memRes.error;
  if (profRes.error) throw profRes.error;
  const profById = new Map((profRes.data ?? []).map((p) => [p.id, p]));
  return (memRes.data ?? [])
    .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.joined_at.localeCompare(b.joined_at)))
    .map((m) => ({
      id: m.id,
      userId: m.user_id,
      role: m.role === 'owner' ? 'owner' : 'member',
      nickname: profById.get(m.user_id)?.nickname ?? '成员',
      avatarUrl: profById.get(m.user_id)?.avatar_url ?? null,
    }));
}

export function useMemberships() {
  return useQuery({ queryKey: queryKeys.memberships, queryFn: fetchMemberships });
}

/** 当前用户所属家庭；无则返回 null（RLS 只返回本人家庭）。 */
export async function fetchMyFamily(): Promise<Family | null> {
  const { data, error } = await supabase.from('families').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export function useMyFamily() {
  return useQuery({ queryKey: queryKeys.family, queryFn: fetchMyFamily });
}

export async function createFamily(name: string, timezone = 'Asia/Shanghai'): Promise<Family> {
  const { data, error } = await supabase.rpc('create_family', {
    p_name: name,
    p_timezone: timezone,
  });
  if (error) throw error;
  return data;
}

/** 户主生成邀请码（forceNew=true 强制刷新换新码）。 */
export async function createInvitation(forceNew = false): Promise<Invitation> {
  const { data, error } = await supabase.rpc('create_invitation', { p_force_new: forceNew });
  if (error) throw error;
  return data;
}

export async function joinFamilyByCode(code: string): Promise<Family> {
  const { data, error } = await supabase.rpc('join_family_by_code', { p_code: code });
  if (error) throw error;
  return data;
}

/** 创建/加入家庭后，profile 与 family 都需刷新。 */
function useFamilyMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.profile });
      qc.invalidateQueries({ queryKey: queryKeys.family });
      qc.invalidateQueries({ queryKey: queryKeys.memberships });
      qc.invalidateQueries({ queryKey: queryKeys.familyMembers });
    },
  });
}

export function useCreateFamily() {
  return useFamilyMutation(({ name, timezone }: { name: string; timezone?: string }) => createFamily(name, timezone));
}

export function useJoinFamily() {
  return useFamilyMutation((code: string) => joinFamilyByCode(code));
}

// ── 家庭生命周期（流程 5：转让 / 退出 / 解散，必须在线）─────────────────────────

/** 户主转让给本家庭某成员。 */
export async function transferOwnership(newOwnerUserId: string): Promise<Family> {
  const { data, error } = await supabase.rpc('transfer_ownership', { p_new_owner: newOwnerUserId });
  if (error) throw error;
  return data;
}

/** 普通成员退出家庭（户主须先转让/解散）。 */
export async function leaveFamily(): Promise<void> {
  const { error } = await supabase.rpc('leave_family');
  if (error) throw error;
}

/** 户主解散家庭。 */
export async function dissolveFamily(): Promise<void> {
  const { error } = await supabase.rpc('dissolve_family');
  if (error) throw error;
}

/** 生命周期操作会改变「当前家庭」，影响面广，成功后全量失效缓存。 */
function useLifecycleMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}

export function useTransferOwnership() {
  return useLifecycleMutation((newOwnerUserId: string) => transferOwnership(newOwnerUserId));
}

/** 无参生命周期操作（退出/解散），mutateAsync() 不带参数。 */
function useVoidLifecycleMutation(fn: () => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}

export function useLeaveFamily() {
  return useVoidLifecycleMutation(leaveFamily);
}

export function useDissolveFamily() {
  return useVoidLifecycleMutation(dissolveFamily);
}
