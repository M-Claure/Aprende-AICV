import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isOnline } from "@/lib/connectivity";

/**
 * Builds the 503 response returned to every request while the host is offline.
 * API routes get the standard JSON error envelope; page requests get a minimal
 * Spanish HTML page so users aren't shown raw JSON.
 */
function offlineResponse(request: NextRequest): NextResponse {
  const message =
    "Sin conexión a internet. Esta aplicación requiere conexión para funcionar.";
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: { code: "service_unavailable", message } },
      { status: 503 },
    );
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Sin conexión</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;text-align:center;color:#111">` +
    `<h1 style="font-size:1.25rem">Sin conexión a internet</h1>` +
    `<p style="color:#555">${message}</p>` +
    `</body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Runs on every request (except static assets and the health probe — see
 * `config.matcher`). Two responsibilities:
 *   1. Online-only guard: block the request with a 503 when the host has no
 *      connectivity to the app's external services (see `lib/connectivity.ts`).
 *   2. Refresh the Supabase auth session so Server Components and route
 *      handlers see a valid session.
 */
export async function middleware(request: NextRequest) {
  // Online-only guard: the app must not function without a connection.
  if (!(await isOnline())) {
    return offlineResponse(request);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  const response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Touching getUser() refreshes the session token cookie when needed.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip static assets and the health probe.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
