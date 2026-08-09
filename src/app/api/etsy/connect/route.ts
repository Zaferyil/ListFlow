import { NextResponse } from "next/server";
import { authorizeUrl, createCodeVerifier, isEtsyConfigured } from "@/lib/etsy-api";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

/**
 * Starts the OAuth handshake. The PKCE verifier and the CSRF state are parked
 * in short-lived httpOnly cookies — the callback is a separate request, so
 * they cannot simply be held in memory.
 */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json(
      { error: "ETSY_KEYSTRING is not set. Add your Etsy app keystring to .env.local." },
      { status: 501 },
    );
  }

  const verifier = createCodeVerifier();
  const state = randomBytes(16).toString("hex");

  const response = NextResponse.redirect(authorizeUrl(state, verifier));
  const cookie = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set("etsy_verifier", verifier, cookie);
  response.cookies.set("etsy_state", state, cookie);
  return response;
}
