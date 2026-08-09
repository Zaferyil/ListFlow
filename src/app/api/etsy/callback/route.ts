import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/etsy-api";
import { storeTokens } from "@/lib/etsy-tokens";

export const runtime = "nodejs";

/** Where Etsy sends the seller back. Finishes the handshake, then returns to the app. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const home = new URL("/", url.origin);

  const denied = url.searchParams.get("error");
  if (denied) {
    home.searchParams.set("etsy", `error:${denied}`);
    return NextResponse.redirect(home);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.headers.get("cookie")?.match(/etsy_state=([^;]+)/)?.[1];
  const verifier = request.headers.get("cookie")?.match(/etsy_verifier=([^;]+)/)?.[1];

  // A mismatched state means the callback did not originate from our redirect.
  if (!code || !verifier || !state || state !== expectedState) {
    home.searchParams.set("etsy", "error:invalid_callback");
    return NextResponse.redirect(home);
  }

  try {
    await storeTokens(await exchangeCode(code, verifier));
    home.searchParams.set("etsy", "connected");
  } catch (error) {
    home.searchParams.set("etsy", `error:${error instanceof Error ? error.message : "failed"}`);
  }

  const response = NextResponse.redirect(home);
  response.cookies.delete("etsy_verifier");
  response.cookies.delete("etsy_state");
  return response;
}
