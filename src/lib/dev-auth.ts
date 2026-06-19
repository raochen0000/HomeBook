/**
 * 开发期测试登录工具（仅用于开发/调试，切勿用于生产）。
 *
 * 背景：实例已开启邮箱注册且 `mailer_autoconfirm = true`，注册即自动确认，
 * 无需短信 OTP / 邮件验证，因此可用「邮箱+密码」快速拿到真实 JWT，
 * 在真实 RLS 下调试前/后端接口。
 */
import { supabase } from './supabase';

export type TestAccount = {
  email: string;
  password: string;
  nickname: string;
};

/** 预置测试账号：A、B 两个，便于测试多用户 / 跨家庭隔离场景。 */
export const TEST_ACCOUNTS: Record<'a' | 'b', TestAccount> = {
  a: { email: 'dev.a@homebook.test', password: 'devtest123456', nickname: '开发测试A' },
  b: { email: 'dev.b@homebook.test', password: 'devtest123456', nickname: '开发测试B' },
};

/** 登录；账号不存在时自动注册（autoconfirm 已开，注册后直接拿到 session）。 */
export async function devSignIn(acc: TestAccount) {
  const signIn = await supabase.auth.signInWithPassword({
    email: acc.email,
    password: acc.password,
  });
  if (!signIn.error) return signIn.data.user;

  // 多为「账号不存在」→ 尝试注册
  const signUp = await supabase.auth.signUp({
    email: acc.email,
    password: acc.password,
    options: { data: { nickname: acc.nickname } },
  });
  if (signUp.error) throw signUp.error;
  return signUp.data.user;
}

export async function devSignOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * 开发期自动登录：仅在 __DEV__ 且当前无 session 时，静默登录默认测试账号，
 * 免去每次手动登录。已存在 session（含手动切换到的其它账号）时不覆盖。
 * 设环境变量 EXPO_PUBLIC_DEV_AUTOLOGIN=0 可关闭（用于调试「未登录」态）。
 */
export async function devAutoSignIn(acc: TestAccount = TEST_ACCOUNTS.a) {
  if (!__DEV__ || process.env.EXPO_PUBLIC_DEV_AUTOLOGIN === '0') return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user;
  try {
    return await devSignIn(acc);
  } catch (e) {
    console.warn('[dev] 自动登录测试账号失败：', e);
    return null;
  }
}

/** 当前登录用户的 profile（含 current_family_id）。未登录返回 null。 */
export async function getMyProfile() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;
  // 同 fetchMyProfile：按自己过滤，避免多人家庭下 RLS 返回多行导致 .single() 报错。
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, current_family_id')
    .eq('id', sessionData.session.user.id)
    .single();
  if (error) throw error;
  return data;
}

/** 确保当前用户有家庭：无则调 create_family RPC 建一个，返回 family_id。 */
export async function ensureFamily(name = '调试之家', timezone = 'Asia/Shanghai') {
  const profile = await getMyProfile();
  if (!profile) throw new Error('请先登录');
  if (profile.current_family_id) return profile.current_family_id as string;

  const { data, error } = await supabase.rpc('create_family', {
    p_name: name,
    p_timezone: timezone,
  });
  if (error) throw error;
  return (data as { id: string }).id;
}

/** 户主生成邀请码（forceNew=true 强制刷新换新码）。返回邀请码与有效期。 */
export async function createInvitation(forceNew = false) {
  const { data, error } = await supabase.rpc('create_invitation', { p_force_new: forceNew });
  if (error) throw error;
  return data as { code: string; expires_at: string; status: string };
}

/** 凭邀请码加入家庭，返回加入后的家庭。 */
export async function joinFamily(code: string) {
  const { data, error } = await supabase.rpc('join_family_by_code', { p_code: code });
  if (error) throw error;
  return data;
}

/** 记一笔示例支出（默认 ¥25.80 餐饮），用于验证写入 + RLS。 */
export async function addSampleExpense(amountCents = 2580, note = '午饭') {
  const profile = await getMyProfile();
  if (!profile?.current_family_id) throw new Error('请先创建/加入家庭');

  const { data: cat, error: catError } = await supabase
    .from('categories')
    .select('id')
    .eq('is_system', true)
    .eq('type', 'expense')
    .eq('name', '餐饮')
    .single();
  if (catError) throw catError;

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      family_id: profile.current_family_id,
      type: 'expense',
      amount: amountCents,
      category_id: cat.id,
      note,
      recorder_user_id: profile.id,
    })
    .select('id, amount, note, occurred_at')
    .single();
  if (error) throw error;
  return data;
}

/** 当前家庭的概览：家庭、成员数、流水数、储蓄目标数（均受 RLS 约束）。 */
export async function fetchOverview() {
  const [families, memberships, transactions, goals] = await Promise.all([
    supabase.from('families').select('id, name, member_count'),
    supabase.from('memberships').select('id', { count: 'exact', head: true }),
    supabase.from('transactions').select('id', { count: 'exact', head: true }),
    supabase.from('savings_goals').select('id', { count: 'exact', head: true }),
  ]);
  return {
    families: families.data ?? [],
    memberCount: memberships.count ?? 0,
    transactionCount: transactions.count ?? 0,
    goalCount: goals.count ?? 0,
  };
}
