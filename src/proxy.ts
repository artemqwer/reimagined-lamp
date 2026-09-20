import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Server-side session handling for page requests. Two jobs:
//
// 1. Gate the app. Until now the only thing standing between a logged-out
//    visitor and /admin was a `useEffect` in the dashboard layout: the server
//    happily prerendered and shipped every dashboard page, and the redirect
//    fired after hydration. The data behind it was safe — every API route checks
//    the session — but the shell, its structure and its bundle were not, and the
//    bounce was visible.
//
// 2. Refresh the Supabase token and write the new cookies back. The route
//    handlers each do this for their own request; nothing did it for a plain
//    page load, so a session left to idle expired client-side.
//
// Named `proxy`, not `middleware`: Next 16 renamed the file convention (the old
// name is deprecated and this file would simply never run under it). Proxy
// defaults to the Node.js runtime, so @supabase/ssr works here unchanged.

/** Reachable signed out. Everything else redirects to /login. */
const PUBLIC_PATHS = new Set(["/", "/login", "/register", "/reset-password"]);

/** The OAuth/recovery landing routes, which by definition run before a session
 *  exists — bouncing them to /login would break every email link. */
const PUBLIC_PREFIXES = ["/auth/"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Misconfigured env would otherwise throw here and 500 every route in the app,
  // including /login — leaving no way to see what went wrong.
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        // Rebuild the response so the refreshed token reaches both the route
        // being rendered (via request cookies) and the browser (via response
        // cookies). Setting only one of the two is the usual way this goes
        // wrong: the token refreshes on every request and never sticks.
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: this revalidates the token against Supabase rather
  // than trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    // Page requests only. The API authenticates per route and answers 401 rather
    // than redirecting, and the metadata files (icons, the share card, robots)
    // are fetched by crawlers with no session at all.
    "/((?!api/|_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|opengraph-image|twitter-image|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpe?g|svg|gif|webp|ico|txt|xml)$).*)",
  ],
};
