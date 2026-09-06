import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_LISTING_IMAGES,
  createDraftListing,
  getShop,
  updateListingInventory,
  uploadListingImage,
} from "@/lib/etsy-api";
import { contentTypeFor, listTemplates, readTemplate } from "@/lib/etsy-templates";
import { getAccessToken } from "@/lib/etsy-tokens";
import { findProduct } from "@/lib/products";

export const runtime = "nodejs";
export const maxDuration = 120;

const variationsSchema = z.object({
  sizeLabel: z.string().trim().min(1).max(45),
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
  /** Which blank's template photos to attach. */
  productId: z.string().trim().min(1).optional(),
});

/** Pushes one generated listing to Etsy as a draft. Nothing is published live. */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { variations, productId, ...draft } = parsed.data;
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);

    // With variations the listing price is the cheapest offering; Etsy shows it
    // as the "from" price and each size overrides it below.
    const price = variations
      ? Math.min(...variations.sizes.map((size) => size.price))
      : draft.price;

    // Get product shipping info if available
    const product = productId ? findProduct(productId) : null;
    const draftWithShipping = {
      ...draft,
      price,
      itemWeight: product?.shippingWeight,
      weightUnit: product?.weightUnit,
      itemLength: product?.shippingDimensions?.length,
      itemWidth: product?.shippingDimensions?.width,
      itemHeight: product?.shippingDimensions?.height,
      dimensionsUnit: product?.dimensionsUnit,
    };

    const listing = await createDraftListing(accessToken, shop.shopId, draftWithShipping);

    // Past this point the draft exists, so a later failure is reported
    // alongside its link rather than thrown — otherwise the seller is left
    // with an orphan they never hear about.
    let variationError: string | undefined;
    let imageError: string | undefined;

    // For ornaments, automatically add standard variations with 3 properties
    let finalVariations = variations;
    if (product?.garment.includes("ornament") && !variations) {
      finalVariations = {
        sizeLabel: "Shape",
        sizes: [
          { name: "Heart", price: draft.price },
          { name: "Round", price: draft.price },
        ],
        colors: ["One-Side", "Two-Sides"],
        materials: Array.from({ length: 12 }, (_, i) => String(i + 1)),
        materialLabel: "Quantity",
        quantity: draft.quantity,
        readinessStateId: draft.readinessStateId,
      };
    }

    if (finalVariations) {
      try {
        await updateListingInventory(accessToken, listing.listingId, {
          ...finalVariations,
          quantity: draft.quantity,
          readinessStateId: draft.readinessStateId,
        });
      } catch (error) {
        variationError = error instanceof Error ? error.message : "Could not add the variations.";
      }
    }

    let uploaded = 0;
    if (productId) {
      // In the order the seller arranged them, and never more than Etsy takes.
      const templates = (await listTemplates(productId)).slice(0, MAX_LISTING_IMAGES);
      try {
        for (const [index, template] of templates.entries()) {
          await uploadListingImage(
            accessToken,
            shop.shopId,
            listing.listingId,
            {
              name: template.name,
              type: contentTypeFor(template.name),
              bytes: await readTemplate(productId, template.name),
            },
            index + 1,
          );
          uploaded += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "upload failed";
        imageError = `${uploaded} of ${templates.length} photos uploaded — ${reason}`;
      }
    }

    return NextResponse.json({
      listing,
      shop,
      variations: Boolean(variations) && !variationError,
      variationError,
      uploaded,
      imageError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
