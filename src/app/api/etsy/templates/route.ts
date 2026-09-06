import { NextResponse } from "next/server";
import {
  MAX_TEMPLATE_IMAGES,
  contentTypeFor,
  deleteTemplate,
  listTemplates,
  readTemplate,
  saveTemplate,
  setOrder,
  type TemplateImage,
} from "@/lib/etsy-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Etsy's own ceiling for a listing photo. */
const MAX_BYTES = 20 * 1024 * 1024;

function productIdFrom(url: string): string | null {
  const value = new URL(url).searchParams.get("productId");
  return value && value.trim() ? value.trim() : null;
}

/** Lists a blank's template photos, or streams one back when `file` is given. */
export async function GET(request: Request) {
  const productId = productIdFrom(request.url);
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  const file = new URL(request.url).searchParams.get("file");
  if (!file) {
    return NextResponse.json({ images: await listTemplates(productId) });
  }

  try {
    const bytes = await readTemplate(productId, file);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "content-type": contentTypeFor(file), "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "No such image." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const productId = productIdFrom(request.url);
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  try {
    const form = await request.formData();
    const files = form.getAll("images").filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No images were sent." }, { status: 400 });
    }

    const saved: TemplateImage[] = [];
    const existing = await listTemplates(productId);
    if (existing.length + files.length > MAX_TEMPLATE_IMAGES) {
      return NextResponse.json(
        { error: `This blank can keep ${MAX_TEMPLATE_IMAGES} template photos.` },
        { status: 400 },
      );
    }

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is larger than 20 MB, which Etsy rejects.` },
          { status: 400 },
        );
      }
      saved.push(await saveTemplate(productId, file.name, Buffer.from(await file.arrayBuffer())));
    }

    // `saved` is what this request wrote, so the browser can show it even if
    // the listing has not caught up with it yet.
    return NextResponse.json({ images: await listTemplates(productId), saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the images.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Reorders the gallery. The body is the full list of names, top first. */
export async function PATCH(request: Request) {
  const productId = productIdFrom(request.url);
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  const body = await request.json();
  if (!Array.isArray(body?.order) || body.order.some((name: unknown) => typeof name !== "string")) {
    return NextResponse.json({ error: "order must be a list of file names." }, { status: 400 });
  }

  return NextResponse.json({ images: await setOrder(productId, body.order) });
}

/** `file` may repeat, so a whole selection is removed in one request. */
export async function DELETE(request: Request) {
  const productId = productIdFrom(request.url);
  const files = new URL(request.url).searchParams.getAll("file");

  if (!productId || files.length === 0) {
    return NextResponse.json({ error: "productId and file are required." }, { status: 400 });
  }

  for (const file of files) {
    await deleteTemplate(productId, file);
  }

  return NextResponse.json({ images: await listTemplates(productId) });
}
