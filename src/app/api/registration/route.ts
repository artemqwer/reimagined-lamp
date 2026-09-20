import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isPlatformAdmin } from "@/lib/authz";
import { isRegistrationEnabled, setRegistrationEnabled } from "@/lib/registrationSetting";

async function getUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Public: /login and /register read this before anyone is signed in, to hide the
// sign-up link / bounce off the register page when sign-up is closed.
export async function GET() {
  return NextResponse.json({ enabled: await isRegistrationEnabled() });
}

// Admin only: flip the flag from the Admin panel.
export async function POST(req: NextRequest) {
  if (!isPlatformAdmin(await getUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = body.enabled === true;
  await setRegistrationEnabled(enabled);
  return NextResponse.json({ enabled });
}
