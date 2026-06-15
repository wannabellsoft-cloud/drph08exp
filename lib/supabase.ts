import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = !!(URL && KEY);

let _client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!isConfigured) {
    throw new Error(
      "Supabase ยังไม่ตั้งค่า — ใส่ NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY ใน Vercel Project Settings → Environment Variables",
    );
  }
  if (!_client) {
    _client = createClient(URL!, KEY!, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
