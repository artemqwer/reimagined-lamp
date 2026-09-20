import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function listAllUsers(): Promise<User[]> {
  const client = adminClient();
  const users: User[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data.users.length) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return users;
}

const AVATAR_COLORS = [
  "#4F46E5",
  "#3B82F6",
  "#7C3AED",
  "#2563EB",
  "#0EA5E9",
  "#059669",
  "#F59E0B",
  "#EC4899",
  "#10B981",
  "#EF4444",
];

export function makeAvatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
