import { NextResponse } from "next/server";
import { inspectListing } from "@/lib/etsy";
import { generateFromDesign, type DesignInput } from "@/lib/listing";
import { rasterizeSvg } from "@/lib/svg";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024;

/** Raster formats the vision API accepts as-is. */
const ALLOWED_TYPES: Record<string, DesignInput["mediaType"]> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

/**
 * SVG isn't accepted by the vision API, so we rasterise it first. Some systems
 * report an SVG as text/xml or send no type at all, so the extension is checked
 * as well as the MIME type.
 */
function isSvg(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    file.type === "text/xml" ||
    file.name.toLowerCase().endsWith(".svg")
  );
}

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

    const source = Buffer.from(await file.arrayBuffer());
    let design: DesignInput;

    if (isSvg(file)) {
      try {
        const raster = rasterizeSvg(source);
        design = {
          data: raster.data,
          mediaType: "image/png",
          flattenedBackground: raster.background,
        };
      } catch (error) {
        // A bad SVG is the seller's file, not a server fault — say so as a 400.
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "SVG donusturulemedi." },
          { status: 400 },
        );
      }
    } else {
      const mediaType = ALLOWED_TYPES[file.type];
      if (!mediaType) {
        return NextResponse.json(
          {
            error: `Desteklenmeyen dosya turu: ${file.type || "bilinmiyor"}. PNG, JPEG, WebP, GIF veya SVG yukleyin.`,
          },
          { status: 415 },
        );
      }
      design = { data: source.toString("base64"), mediaType };
    }

    // Sent as a comma-separated field so the form stays a flat multipart body.
    const requiredKeywords = String(form.get("requiredKeywords") ?? "")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 5);

    const listing = await generateFromDesign(design, {
      context: String(form.get("context") ?? ""),
      requiredKeywords,
    });

    return NextResponse.json({ listing, warnings: inspectListing(listing, requiredKeywords) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Beklenmeyen bir hata olustu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
