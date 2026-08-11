import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, originOf } from "@/lib/etsy-api";
import { storeTokens } from "@/lib/etsy-tokens";

export const runtime = "nodejs";

/** Sends the seller back to the app with a message, and clears the handshake cookies. */
function back(origin: string, message: string): NextResponse {
  const home = new URL("/", origin);
  home.searchParams.set("etsy", message);

  const response = NextResponse.redirect(home);
  response.cookies.delete("etsy_verifier");
  response.cookies.delete("etsy_state");
  return response;
}

/** Where Etsy sends the seller back. Finishes the handshake, then returns to the app. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // The public address, not the proxy's internal one — this is where the
  // seller's browser has to end up.
  const origin = originOf(request);

  const denied = url.searchParams.get("error");
  if (denied) {
    return back(origin, `error:${url.searchParams.get("error_description") ?? denied}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("etsy_state")?.value;
  const verifier = request.cookies.get("etsy_verifier")?.value;

  // Each of these fails for its own reason, and the fix differs, so say which.
  if (!code) {
    return back(origin, "error:Etsy did not send an authorization code. Start from Connect to Etsy.");
  }
  if (!verifier || !expectedState) {
    return back(
      origin,
      "error:The sign-in cookie was missing. It expires after 10 minutes, and it is dropped if you open the callback link directly or block cookies. Press Connect to Etsy and finish in the same window.",
    );
  }
  if (state !== expectedState) {
    return back(
      origin,
      "error:The sign-in did not match this window — this happens when Connect is pressed twice. Press Connect to Etsy once and finish that tab.",
    );
  }

  try {
    await storeTokens(await exchangeCode(code, verifier, originOf(request)));
    return back(origin, "connected");
  } catch (error) {
    return back(origin, `error:${error instanceof Error ? error.message : "Token exchange failed."}`);
  }
}
