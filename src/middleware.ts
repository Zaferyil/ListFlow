import { NextResponse, type NextRequest } from "next/server";
import { appPassword, matches, SESSION_COOKIE, sessionToken } from "@/lib/auth";

/**
 * Gates every page and API route behind the shared password.
 *
 * With APP_PASSWORD unset the app is open, which keeps it frictionless on your
 * own machine — but only in development. A production build with no password
 * refuses to serve anything, so a deploy cannot accidentally go up unprotected.
 */
export async function middleware(request: NextRequest) {
  const password = appPassword();

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();

    return NextResponse.json(
      { error: "APP_PASSWORD is not set. Set it in the deployment's environment variables." },
      { status: 503 },
    );
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && matches(cookie, await sessionToken(password))) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to ListFlow first." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything but the login screen, its own endpoint, Next's static assets,
  // and the icons — a phone fetches those while adding the app to the home
  // screen, without the session cookie, and a redirect to /login there leaves
  // it with no icon to show.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)",
  ],
};
