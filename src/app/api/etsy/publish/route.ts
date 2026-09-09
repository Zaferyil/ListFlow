import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_LISTING_IMAGES,
  createDraftListing,
  getShop,
  getTaxonomyProperties,
  matchAttributes,
  updateListingInventory,
  updateListingProperty,
  uploadListingImage,
  type VariationInput,
} from "@/lib/etsy-api";
import { contentTypeFor, listTemplates, readTemplate } from "@/lib/etsy-templates";
import { getAccessToken } from "@/lib/etsy-tokens";
import { findProduct, isOrnament as isOrnamentProduct } from "@/lib/products";

export const runtime = "nodejs";
export const maxDuration = 120;

const variationsSchema = z.object({
  sizeLabel: z.string().trim().min(1).max(45),
  sizes: z
    .array(z.object({ name: z.string().trim().min(1), price: z.number().positive() }))
    .min(1),
  colors: z.array(z.string().trim().min(1)),
  /** Name of the second menu. Ornaments name it for the shape, not colour. */
  colorLabel: z.string().trim().min(1).max(45).optional(),
  /** Show the priced menu second — see VariationInput.pricedMenuSecond. */
  pricedMenuSecond: z.boolean().optional(),
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
  /** Suggested Etsy attributes as "Holiday: Christmas" lines, one per line. */
  attributes: z.string().trim().max(2000).optional(),
});

/**
 * Stock held against each ornament offering. Ornaments are stocked per
 * shape/print/quantity combination rather than per listing, and the figure is
 * the same on every one, so it is a constant here rather than another field for
 * the seller to fill in on each listing.
 */
const ORNAMENT_STOCK = 15;

/** Pushes one generated listing to Etsy as a draft. Nothing is published live. */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { variations, productId, attributes, ...draft } = parsed.data;
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
    let attributeError: string | undefined;
    let attributesSet = 0;

    // An ornament varies on shape and on print side. Etsy has two variation
    // slots — property 515 is deprecated and rejected outright — and they go to
    // exactly those two; quantity is left to the picker Etsy puts on every
    // listing, which sat under ours as a second "Quantity" menu when we ran one
    // of our own. Price follows the print side, so that menu is the priced one
    // even though it is shown second. The panel normally sends its own edited
    // styles and prices; this stands in for callers that send none.
    const isOrnament = product !== null && isOrnamentProduct(product);
    // Ornaments carry their stock per offering; everything else stocks the
    // listing as a whole and repeats that figure across its variations.
    const variationQuantity = isOrnament ? ORNAMENT_STOCK : draft.quantity;

    let finalVariations: VariationInput | undefined;
    if (isOrnament && !variations) {
      finalVariations = {
        sizeLabel: "Print Option",
        sizes: [
          { name: "One-Sided", price: draft.price },
          { name: "Two-Sided", price: draft.price },
        ],
        colors: ["Heart Ornament", "Round Ornament"],
        colorLabel: "Ornament Styles",
        pricedMenuSecond: true,
        quantity: variationQuantity,
        readinessStateId: draft.readinessStateId,
      };
    } else if (variations) {
      finalVariations = {
        ...variations,
        quantity: variationQuantity,
        readinessStateId: draft.readinessStateId,
      };
    }

    // Both branches above already carry the right quantity.
    if (finalVariations) {
      try {
        await updateListingInventory(accessToken, listing.listingId, finalVariations);
      } catch (error) {
        variationError = error instanceof Error ? error.message : "Could not add the variations.";
      }
    }

    // Attributes are what Etsy's own filters run on — a shopper narrowing to
    // Christmas ornaments is reading these, not the tags — so they are worth
    // setting even though nothing fails without them.
    if (attributes) {
      try {
        const matched = matchAttributes(
          attributes,
          await getTaxonomyProperties(accessToken, draft.taxonomyId),
        );

        for (const attribute of matched) {
          await updateListingProperty(accessToken, shop.shopId, listing.listingId, attribute);
          attributesSet += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "the request failed";
        attributeError = `${attributesSet} attribute${attributesSet === 1 ? "" : "s"} set — ${reason}`;
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
      attributesSet,
      attributeError,
      uploaded,
      imageError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
