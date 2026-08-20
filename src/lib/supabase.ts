import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import type { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY in .env');
}

let parsedSupabaseUrl: URL;
try {
  parsedSupabaseUrl = new URL(supabaseUrl);
} catch {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL must be a valid absolute URL');
}

// 生产包处理的是登录凭据与家庭财务数据，绝不允许以明文 HTTP 传输。
// 开发期可配合 APP_VARIANT=development 继续联调迁移中的自托管 HTTP 实例。
if (!__DEV__ && parsedSupabaseUrl.protocol !== 'https:') {
  throw new Error('Production requires EXPO_PUBLIC_SUPABASE_URL to use HTTPS');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    // AsyncStorage isn't available on web during SSR; let supabase-js
    // fall back to its default web storage there.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
