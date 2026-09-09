import { NextResponse } from "next/server";
import { z } from "zod";
import { getListing, getShop, updateListingText } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";
import { inspectListing, introducedNumbers } from "@/lib/etsy";
import { rewriteListing } from "@/lib/listing";

export const runtime = "nodejs";
export const maxDuration = 120;

const proposeSchema = z.object({ listingId: z.number().int().positive() });

const applySchema = z.object({
  listingId: z.number().int().positive(),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(13),
});

/**
 * Proposes a rewrite. Deliberately does not apply it: a live listing carries
 * its own search history, and whether that is worth trading for better wording
 * is the seller's call, made one listing at a time against the two versions
 * side by side.
 */
export async function POST(request: Request) {
  try {
    const parsed = proposeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const accessToken = await getAccessToken();
    const existing = await getListing(accessToken, parsed.data.listingId);
    const proposed = await rewriteListing(existing);
    return NextResponse.json({
      existing,
      proposed,
      warnings: inspectListing(proposed),
      // Checked rather than trusted: the instruction not to invent facts is the
      // only thing standing between a rewrite and a specification the seller
      // never claimed, and an instruction is not a guarantee.
      introduced: introducedNumbers(
        `${existing.title} ${existing.description}`,
        `${proposed.title} ${proposed.description}`,
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not rewrite that listing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Applies a rewrite the seller has read and accepted. */
export async function PUT(request: Request) {
  try {
    const parsed = applySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { listingId, ...text } = parsed.data;
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    await updateListingText(accessToken, shop.shopId, listingId, text);

    return NextResponse.json({ updated: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that listing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
