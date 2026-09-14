import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/publish-settings";

export const runtime = "nodejs";

function productIdFrom(url: string): string | null {
  const value = new URL(url).searchParams.get("productId");
  return value && value.trim() ? value.trim() : null;
}

/** A blank's saved publishing settings, or null when it has none yet. */
export async function GET(request: Request) {
  const productId = productIdFrom(request.url);
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ settings: await readSettings(productId) });
  } catch (error) {
    // The panel falls back to what the browser has, so a store that cannot be
    // reached costs the sync rather than the settings.
    const message = error instanceof Error ? error.message : "Could not read your settings.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const productId = productIdFrom(request.url);
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Settings must be an object." }, { status: 400 });
    }

    const saved = await writeSettings(productId, body as Record<string, unknown>);
    if (!saved) {
      return NextResponse.json({ error: "That is not a product id." }, { status: 400 });
    }

    return NextResponse.json({ saved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your settings.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
