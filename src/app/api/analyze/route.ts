import { NextResponse } from "next/server";
import { inspectListing } from "@/lib/etsy";
import { generateFromDesign, type DesignInput } from "@/lib/listing";
import { requiredKeywordsFor } from "@/lib/products";
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
      return NextResponse.json({ error: "No design file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is too large (max ${MAX_BYTES / 1024 / 1024} MB).` },
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
          { error: error instanceof Error ? error.message : "Could not convert the SVG." },
          { status: 400 },
        );
      }
    } else {
      const mediaType = ALLOWED_TYPES[file.type];
      if (!mediaType) {
        return NextResponse.json(
          {
            error: `Unsupported file type: ${file.type || "unknown"}. Upload PNG, JPEG, WebP, GIF or SVG.`,
          },
          { status: 415 },
        );
      }
      design = { data: source.toString("base64"), mediaType };
    }

    const productId = String(form.get("productId") ?? "") || undefined;

    const listing = await generateFromDesign(design, { productId });

    return NextResponse.json({
      listing,
      warnings: inspectListing(listing, requiredKeywordsFor(productId)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
