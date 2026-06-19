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
  const { data, error } = await supabase.from('profiles').select('*').single();
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
    },
  });
}

export function useCreateFamily() {
  return useFamilyMutation(({ name, timezone }: { name: string; timezone?: string }) => createFamily(name, timezone));
}

export function useJoinFamily() {
  return useFamilyMutation((code: string) => joinFamilyByCode(code));
}
