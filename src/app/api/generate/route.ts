import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectListing } from "@/lib/etsy";
import { generateFromNiche } from "@/lib/listing";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  niche: z.string().trim().min(2, "Niche is too short.").max(500),
  context: z.string().trim().max(2000).optional(),
  requiredKeywords: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { niche, context, requiredKeywords } = parsed.data;
    const listing = await generateFromNiche(niche, { context, requiredKeywords });

    return NextResponse.json({ listing, warnings: inspectListing(listing, requiredKeywords) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
