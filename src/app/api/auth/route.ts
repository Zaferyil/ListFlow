import { NextResponse } from "next/server";
import { appPassword, matches, SESSION_COOKIE, sessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/** Signs in with the shared password. */
export async function POST(request: Request) {
  const password = appPassword();
  if (!password) {
    return NextResponse.json({ error: "APP_PASSWORD is not set." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const given = typeof body?.password === "string" ? body.password : "";

  if (!matches(given, password)) {
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
