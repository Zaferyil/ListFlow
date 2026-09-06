import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_LISTING_IMAGES,
  createDraftListing,
  getShop,
  updateListingInventory,
  uploadListingImage,
  type VariationInput,
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
  /** Name of the second menu. Ornaments put quantity there rather than colour. */
  colorLabel: z.string().trim().min(1).max(45).optional(),
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
  /** For ornaments: quantity per variation (1-12). */
  ornamentQuantity: z.number().int().min(1).max(12).optional(),
});

/** Pushes one generated listing to Etsy as a draft. Nothing is published live. */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { variations, productId, ornamentQuantity, ...draft } = parsed.data;
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

    // For ornaments, automatically add standard variations using 2 properties
    // Combine Shape + Print into sizes, use Quantity as colors
    // (Property 515 is deprecated, so we can't use 3 properties)
    let finalVariations: VariationInput | undefined;
    if (product?.garment.includes("ornament") && !variations) {
      const qty = ornamentQuantity || 1;
      // Create all combinations of Shape × Print
      const shapes = ["Heart", "Round"];
      const prints = ["One-Side", "Two-Sides"];
      const combinedSizes: { name: string; price: number }[] = [];

      for (const shape of shapes) {
        for (const print of prints) {
          combinedSizes.push({
            name: `${shape} ${print}`,
            price: draft.price,
          });
        }
      }

      // Quantities 1-12 as color options
      const quantities = Array.from({ length: 12 }, (_, i) => String(i + 1));

      finalVariations = {
        sizeLabel: "Style",
        sizes: combinedSizes,
        colors: quantities,
        colorLabel: "Quantity",
        quantity: qty,
        readinessStateId: draft.readinessStateId,
      };
    } else if (variations) {
      finalVariations = {
        ...variations,
        quantity: draft.quantity,
        readinessStateId: draft.readinessStateId,
      };
    }

    // Both branches above already carry the right quantity — the ornament
    // defaults use the seller's per-variation stock, not the listing's.
    if (finalVariations) {
      try {
        await updateListingInventory(accessToken, listing.listingId, finalVariations);
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
      // Reported off what was actually sent, so the ornament defaults — which
      // the request itself never carries — are not shown as "no variations".
      variations: Boolean(finalVariations) && !variationError,
      variationCount:
        finalVariations && !variationError
          ? finalVariations.sizes.length * Math.max(finalVariations.colors.length, 1)
          : 0,
      variationError,
      uploaded,
      imageError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
