import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectListing } from "@/lib/etsy";
import { generateFromNiche } from "@/lib/listing";
import { requiredKeywordsFor } from "@/lib/products";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  niche: z.string().trim().min(2, "Niche is too short.").max(500),
  productId: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { niche, productId } = parsed.data;
    const listing = await generateFromNiche(niche, { productId });

    return NextResponse.json({ listing, warnings: inspectListing(listing, requiredKeywordsFor(productId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
