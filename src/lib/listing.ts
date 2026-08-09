import type OpenAI from "openai";
import { getClient, MODEL } from "./openai";
import {
  ETSY_LIMITS,
  type Listing,
  MAX_TAGS_PER_REQUIRED_KEYWORD,
  missingRequiredKeywords,
  normalizeListing,
} from "./etsy";
import { DEFAULT_PRODUCT_ID, findProduct, productFacts, type Product } from "./products";

type UserContent = OpenAI.Chat.Completions.ChatCompletionContentPart;

export interface GenerateOptions {
  /** Which blank the design is printed on. Defaults to the first in the catalog. */
  productId?: string;
}

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: `Etsy listing title, at most ${ETSY_LIMITS.titleMaxChars} characters. The FIRST 3-4 WORDS must be the exact phrase a buyer types into Etsy search, then separate secondary phrases with commas or pipes.`,
    },
    description: {
      type: "string",
      description:
        "Etsy listing description for a printed shirt. Open with a one-sentence hook that repeats the main keyword, then cover what the shirt is, who it suits, the fit and feel, occasions to wear or gift it, and care. Use short paragraphs and a bulleted list.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: `Exactly ${ETSY_LIMITS.maxTags} Etsy tags, each at most ${ETSY_LIMITS.tagMaxChars} characters. Prefer multi-word long-tail phrases that a buyer would actually type. No duplicated phrases, no single generic words like "gift", and never a file format or download phrase.`,
    },
    category: {
      type: "string",
      description:
        "Suggested Etsy category path under Clothing, e.g. 'Clothing > Unisex Adult Clothing > T-Shirts & Tees'.",
    },
    notes: {
      type: "string",
      description:
        "Two or three sentences for the seller explaining the keyword strategy behind these choices, and anything they should verify manually.",
    },
  },
  required: ["title", "description", "tags", "category", "notes"],
  additionalProperties: false,
} as const;

function systemPrompt(product: Product, requiredKeywords: string[]): string {
  const lines = [
    "You are an Etsy SEO specialist who writes listings that rank in Etsy search and convert browsers into buyers.",
    "You write for the US Etsy market: American English spelling, American sizing conventions, and phrasing a US buyer would use.",
    "",
    `THE PRODUCT IS ALWAYS A PHYSICAL PRINTED ${product.garment.toUpperCase()} that the seller prints and ships. It is never a digital file.`,
    `- When you are shown a design, that design is what gets printed on the ${product.garment}. The listing sells the finished garment, not the artwork and not the file.`,
    "- Never write the listing as a digital download, printable, clipart, cut file, or sublimation file, and never say a file is delivered or downloaded.",
    "- Never put a file format or download phrase in the title, the tags, or the materials: no PNG, SVG, JPG, PDF, EPS, DXF, 'digital download', 'instant download', 'printable', 'downloadable', 'clipart', 'cut file'. A buyer searching those wants a file, not your shirt, so they are the wrong traffic.",
    "- Write for someone who will wear it or gift it. Cover fit, feel, and occasion instead of file contents.",
    "",
    "The blank is fixed. These are manufacturer specifications, verified — you may state them as fact, and you should, because fabric and fit are what a buyer compares between listings:",
    ...productFacts(product),
    `- Call the garment a ${product.garment} in the copy. Do not call it a tee if it is a sweatshirt, or the other way round.`,
    "- Do not go beyond these facts. Sizing charts, exact colour names, print method and shipping are still unknown unless the seller told you.",
    "",
    "Rules you must follow:",
    `- Title: at most ${ETSY_LIMITS.titleMaxChars} characters, and aim for 110-140 to use the space Etsy gives you.`,
    "- THE OPENING OF THE TITLE IS THE MOST IMPORTANT RANKING SIGNAL. Etsy weights the first few words most heavily, so the first 3-4 words must be, verbatim, the phrase a buyer would type into the search box.",
    "- Do not open the title with a brand name, a shop name, an adjective like 'Beautiful' or 'Unique', or a filler word. Those go later in the title. A brand belongs at the front only when buyers genuinely search for that brand first.",
    "- The opening phrase must also appear among the tags. If you would not use it as a tag, it is not a search phrase and does not belong at the front of the title.",
    `- Tags: exactly ${ETSY_LIMITS.maxTags} tags, each at most ${ETSY_LIMITS.tagMaxChars} characters.`,
    "- Tags must be long-tail buyer phrases, not one-word categories, and must not simply repeat each other.",
    "- Beyond the specifications above, never invent product attributes. If a detail is unknown, describe the printed design instead of guessing at the sizing chart, print method, or shipping.",
    "- Do not promise delivery times or refunds.",
  ];

  if (requiredKeywords.length > 0) {
    const list = requiredKeywords.map((keyword) => `"${keyword}"`).join(", ");
    lines.push(
      "",
      "Required keywords:",
      `- Each of these terms must appear in the title, at least once in the description, and inside at least one tag: ${list}.`,
      "- Etsy matches title, description and tags separately, so a term present in only one of them is invisible in the other two.",
      "- Keep the term readable in context — work it into a natural phrase (e.g. a tag like 'comfort colors tee'), do not bolt it on as a bare label.",
      "- These terms are additional to, not a replacement for, the search phrase that opens the title.",
      `- AT MOST ${MAX_TAGS_PER_REQUIRED_KEYWORD} tags may contain any one of these terms. Two variants already cover that search; a third is a tag slot competing with your own listing instead of reaching a different query. Spend the remaining tags on the design, the occasion, the recipient, and the style.`,
    );
  }

  return lines.join("\n");
}

/** One structured-output call. */
async function callModel(
  content: UserContent[],
  product: Product,
  requiredKeywords: string[],
): Promise<Listing> {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: 4000,
    response_format: {
      type: "json_schema",
      json_schema: { name: "etsy_listing", strict: true, schema: LISTING_SCHEMA },
    },
    messages: [
      { role: "system", content: systemPrompt(product, requiredKeywords) },
      { role: "user", content },
    ],
  });

  const message = response.choices[0]?.message;

  if (message?.refusal) {
    throw new Error(`The model refused this request: ${message.refusal}`);
  }
  // Strict schema output is only complete if generation wasn't cut short.
  if (response.choices[0]?.finish_reason === "length") {
    throw new Error("The response hit the token limit. Try again with shorter context.");
  }
  if (!message?.content) {
    throw new Error("The model returned an empty response. Try again.");
  }

  const generated = JSON.parse(message.content) as Omit<Listing, "materials">;

  // Materials are verified manufacturer facts, so they come from the catalog
  // rather than from generation — there is nothing here for a model to get right
  // that it could not also get wrong.
  return normalizeListing({ ...generated, materials: product.materials });
}

/**
 * Runs the request and, when a required keyword is missing from one of the
 * three match surfaces, retries once with the gap spelled out. A brand term the
 * seller explicitly asked for is worth one extra call — patching it in by
 * string surgery would produce a title that reads like a keyword dump.
 */
async function requestListing(
  content: UserContent[],
  options: GenerateOptions,
): Promise<Listing> {
  const product = findProduct(options.productId ?? DEFAULT_PRODUCT_ID);
  const requiredKeywords = product.requiredKeywords;

  const listing = await callModel(content, product, requiredKeywords);

  const missing = missingRequiredKeywords(listing, requiredKeywords);
  if (missing.length === 0) return listing;

  const fieldNames = { title: "the title", description: "the description", tags: "the tags" };
  const corrections = missing.map(
    (entry) =>
      `- "${entry.keyword}" is missing from ${entry.fields.map((f) => fieldNames[f]).join(" and ")}.`,
  );

  const retry = await callModel(
    [
      ...content,
      {
        type: "text",
        text: [
          "A previous attempt at this listing failed its keyword requirements:",
          ...corrections,
          "",
          "Write the listing again with those terms worked in naturally, while keeping every other rule — especially that the first 3-4 words of the title are the buyer's search phrase.",
        ].join("\n"),
      },
    ],
    product,
    requiredKeywords,
  );

  // If the retry still falls short, return it anyway — inspectListing surfaces
  // the gap in the UI, which beats failing the whole request.
  return missingRequiredKeywords(retry, requiredKeywords).length <= missing.length
    ? retry
    : listing;
}

/** Generates a listing from a niche keyword pulled out of a Google Sheet. */
export function generateFromNiche(niche: string, options: GenerateOptions = {}): Promise<Listing> {
  const product = findProduct(options.productId ?? DEFAULT_PRODUCT_ID);
  const prompt = `Write an Etsy listing for a printed ${product.garment} in this niche:\n\n${niche}`;

  return requestListing([{ type: "text", text: prompt }], options);
}

export interface DesignInput {
  /** Base64-encoded image data, without the data: URI prefix. */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /**
   * Set when the image came from a vector file we rasterised ourselves. The
   * background is then ours, not the seller's, and must not be described as
   * part of the artwork.
   */
  flattenedBackground?: "light" | "dark";
}

/** Generates a listing by looking at an uploaded design file. */
export function generateFromDesign(
  design: DesignInput,
  options: GenerateOptions = {},
): Promise<Listing> {
  const prompt = [
    `This design is printed on a ${findProduct(options.productId ?? DEFAULT_PRODUCT_ID).garment}. Write the Etsy listing for that garment.`,
    "Describe what you actually see in the design — subject, wording, style, colour palette, typography, mood — and build the keywords from that.",
    "The design is the selling point, but the product being sold is the garment itself.",
    design.flattenedBackground
      ? `\nThis image was converted from a vector file with a transparent background. The flat ${design.flattenedBackground} backdrop was added by that conversion — it is not part of the design. Ignore it entirely: do not mention it, do not treat it as a colour of the artwork, and assume the design is printed on the garment colour the seller chooses.`
      : "",
  ].join("\n");

  return requestListing(
    [
      {
        type: "image_url",
        image_url: { url: `data:${design.mediaType};base64,${design.data}` },
      },
      { type: "text", text: prompt },
    ],
    options,
  );
}
