import { NextResponse } from "next/server";
import { z } from "zod";
import { createDraftListing, getShop, updateListingInventory } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

const variationsSchema = z.object({
  sizes: z
    .array(z.object({ name: z.string().trim().min(1), price: z.number().positive() }))
    .min(1),
  colors: z.array(z.string().trim().min(1)),
});

const bodySchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(13),
  materials: z.array(z.string().trim().min(1)).max(13),
  taxonomyId: z.number().int().positive(),
  shippingProfileId: z.number().int().positive().optional(),
  // Etsy requires a processing profile on every physical listing.
  readinessStateId: z.number().int().positive(),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  whoMade: z.enum(["i_did", "someone_else", "collective"]),
  whenMade: z.string().trim().min(1),
  variations: variationsSchema.optional(),
});

/** Pushes one generated listing to Etsy as a draft. Nothing is published live. */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { variations, ...draft } = parsed.data;
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);

    // With variations the listing price is the cheapest offering; Etsy shows it
    // as the "from" price and each size overrides it below.
    const price = variations
      ? Math.min(...variations.sizes.map((size) => size.price))
      : draft.price;

    const listing = await createDraftListing(accessToken, shop.shopId, { ...draft, price });

    if (!variations) {
      return NextResponse.json({ listing, shop });
    }

    try {
      await updateListingInventory(accessToken, listing.listingId, {
        ...variations,
        quantity: draft.quantity,
        readinessStateId: draft.readinessStateId,
      });
    } catch (error) {
      // The draft exists at this point, so losing it in a 500 would leave an
      // orphan the seller never hears about.
      return NextResponse.json({
        listing,
        shop,
        variationError: error instanceof Error ? error.message : "Could not add the variations.",
      });
    }

    return NextResponse.json({ listing, shop, variations: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
