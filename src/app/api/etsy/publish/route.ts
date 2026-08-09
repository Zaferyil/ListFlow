import { NextResponse } from "next/server";
import { z } from "zod";
import { createDraftListing, getShop } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(13),
  materials: z.array(z.string().trim().min(1)).max(13),
  taxonomyId: z.number().int().positive(),
  shippingProfileId: z.number().int().positive().optional(),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  whoMade: z.enum(["i_did", "someone_else", "collective"]),
  whenMade: z.string().trim().min(1),
});

/** Pushes one generated listing to Etsy as a draft. Nothing is published live. */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    const listing = await createDraftListing(accessToken, shop.shopId, parsed.data);

    return NextResponse.json({ listing, shop });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
