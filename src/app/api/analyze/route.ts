import { NextResponse } from "next/server";
import { inspectListing } from "@/lib/etsy";
import { generateFromDesign, type DesignInput } from "@/lib/listing";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, DesignInput["mediaType"]> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("design");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Tasarim dosyasi eksik." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Dosya cok buyuk (max ${MAX_BYTES / 1024 / 1024} MB).` },
        { status: 413 },
      );
    }

    const mediaType = ALLOWED_TYPES[file.type];
    if (!mediaType) {
      return NextResponse.json(
        { error: `Desteklenmeyen dosya turu: ${file.type || "bilinmiyor"}. PNG, JPEG, WebP veya GIF yukleyin.` },
        { status: 415 },
      );
    }

    const data = Buffer.from(await file.arrayBuffer()).toString("base64");

    // Sent as a comma-separated field so the form stays a flat multipart body.
    const requiredKeywords = String(form.get("requiredKeywords") ?? "")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 5);

    const listing = await generateFromDesign(
      { data, mediaType },
      { context: String(form.get("context") ?? ""), requiredKeywords },
    );

    return NextResponse.json({ listing, warnings: inspectListing(listing, requiredKeywords) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Beklenmeyen bir hata olustu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
