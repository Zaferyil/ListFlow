import type OpenAI from "openai";
import { getClient, MODEL } from "./openai";
import {
  ETSY_LIMITS,
  type Listing,
  MAX_TAGS_PER_REQUIRED_KEYWORD,
  missingRequiredKeywords,
  normalizeListing,
} from "./etsy";
import {
  DEFAULT_PRODUCT_ID,
  findProduct,
  isOrnament,
  productFacts,
  type Product,
} from "./products";

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
      description: `Etsy listing title, at most ${ETSY_LIMITS.titleMaxChars} characters and ideally under 15 words. It must read as a title a person wrote: say what the product is first, then its strongest identifying traits, separated by commas. Never a chain of repeated keywords.`,
    },
    description: {
      type: "string",
      description:
        "Etsy listing description written for a buyer. The opening sentences say what the product is, what the design shows, and the one thing that sets it apart, with the important search phrases carried naturally. Then short labelled sections covering only what is actually known about this product.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: `Exactly ${ETSY_LIMITS.maxTags} Etsy tags, each at most ${ETSY_LIMITS.tagMaxChars} characters. Every tag is a distinct search a real buyer would type, spread across product type, theme, style, audience, occasion and material. No near-duplicates, no misspellings, no file or download terms.`,
    },
    category: {
      type: "string",
      description:
        "The most specific accurate Etsy category path for this actual product, e.g. 'Clothing > Unisex Adult Clothing > T-Shirts & Tees' or 'Home & Living > Home Decor > Ornaments & Accents > Ornaments'. Never a broad category where a specific one exists, and never chosen for search volume over accuracy.",
    },
    attributes: {
      type: "string",
      description:
        "Etsy attribute values to set on the listing, as 'Attribute: value' pairs separated by newlines — e.g. 'Holiday: Christmas'. Only attributes that exist for the chosen category and only values supported by the product facts. Empty string if none apply.",
    },
    notes: {
      type: "string",
      description:
        "Two or three sentences for the seller explaining the keyword strategy behind these choices, and anything they should verify manually.",
    },
  },
  required: ["title", "description", "tags", "category", "attributes", "notes"],
  additionalProperties: false,
} as const;

/** How to build a title and pick keywords for each kind of product. */
function strategyFor(product: Product): string[] {
  if (isOrnament(product)) {
    return [
      `This is an ornament, not apparel. Build the title from the ornament itself, the theme or occasion it is for, the design, and the material where it genuinely distinguishes the product.`,
      "A title of this shape works well: \"Personalized Family Christmas Ornament, Ceramic, Custom Names\".",
      "Never borrow apparel wording. No fit, no sizing, no sleeves, no \"tee\", and nothing about how it wears.",
    ];
  }

  const audience =
    product.audience === "youth"
      ? "This is a youth garment, so kids/youth wording belongs in the title and keywords — write for the adult buying it for a child."
      : "Name the audience only where it genuinely narrows the search, such as women's or men's; do not add one to fill space.";

  return [
    `This is apparel. Build the title from the product type, the design or theme, the style, and the audience where it genuinely helps.`,
    'A title of this shape works well: "Vintage Halloween Ghost T-Shirt, Retro Graphic Tee".',
    audience,
    `Call it a ${product.garment}. Do not call it a tee if it is a sweatshirt, or the other way round.`,
  ];
}

function systemPrompt(product: Product, requiredKeywords: string[]): string {
  const noun = product.garment;

  const lines = [
    "You are an Etsy listing specialist. You optimize for Etsy search as it works now, not for the keyword-stuffing tactics that used to work.",
    "You write for the US Etsy market: American English spelling and phrasing a US buyer would use.",
    "",
    `THE PRODUCT IS ALWAYS A PHYSICAL ${noun.toUpperCase()} that the seller makes and ships. It is never a digital file.`,
    `- When you are shown a design, that design is what gets printed on the ${noun}. The listing sells the finished ${noun}, not the artwork and not the file.`,
    "- Never write the listing as a digital download, printable, clipart, cut file, or sublimation file, and never say a file is delivered or downloaded.",
    "- Never put a file format or download phrase in the title, the tags, or the materials: no PNG, SVG, JPG, PDF, EPS, DXF, 'digital download', 'instant download', 'printable', 'downloadable', 'clipart', 'cut file'. A buyer searching those wants a file, so they are the wrong traffic entirely.",
    "",
    "PRODUCT FACTS. These are verified manufacturer specifications and they are the source of truth. You may state them, and you should, because they are what a buyer compares between listings:",
    ...productFacts(product),
    "- Never invent anything beyond these facts: no material, no size, no colour, no production method, no care instructions, no dimensions. If a detail is unknown, write about the design instead of guessing.",
    product.personalization
      ? "- The buyer personalizes this product with their own text, so \"personalized\", \"custom name\" and similar wording is accurate here and worth putting in the title and tags — buyers search for it. Say what they can put on it, never how it is applied."
      : "- This product is not personalized. Never call it personalized, custom, or made with the buyer's name — that is a promise the seller cannot keep on this listing.",
    "- Do not promise delivery times, processing times or refunds.",
    "",
    "TITLE.",
    `- At most ${ETSY_LIMITS.titleMaxChars} characters, but length is not a target — aim for under 15 words. A shorter title that reads clearly beats a longer one padded with keywords.`,
    "- A buyer must know what the product is from the first few words. Lead with the product type and its strongest identifying trait, then add the theme, style or material.",
    "- It has to read like a title a real seller wrote for a human. Never a chain of comma-separated keywords.",
    '- Never repeat a word or phrase to gain ranking. "Halloween Shirt Halloween T Shirt Halloween Gift Spooky Shirt" is exactly what to avoid.',
    "- Banned outright: SALE, ON SALE, FREE SHIPPING, BEST SELLER, PERFECT GIFT, BEST GIFT, AMAZING, BEAUTIFUL, MUST HAVE, CHEAP, BEST, #1, and any other promotional wording.",
    "- Do not add a recipient or an occasion just to fill the title. Include one only when it genuinely identifies the product.",
    "",
    "PRODUCT STRATEGY.",
    ...strategyFor(product).map((line) => `- ${line}`),
    "",
    `TAGS. Exactly ${ETSY_LIMITS.maxTags}, each at most ${ETSY_LIMITS.tagMaxChars} characters.`,
    "- Each tag is a separate search opportunity. Spend them across different kinds of search: the core product type, the design or theme, the style, the audience, the occasion or use, the material, and a longer specific phrase or two.",
    "- Multi-word phrases beat single words. Ask of each one: would a real buyer type this into Etsy? If not, drop it.",
    "- Do not write thirteen versions of one phrase. Near-duplicates compete with each other instead of reaching a new query.",
    "- No deliberate misspellings, no unrelated trending terms, no second language, and no trademark or celebrity terms unless the product facts genuinely support them.",
    "- Do not spend a tag restating what the category or an attribute already tells Etsy, unless it is also a phrase buyers really search.",
    "",
    "DESCRIPTION.",
    "- Write for a human buyer first, carrying the important phrases naturally as you go.",
    "- The opening sentences make clear what the product is, what the design shows, and the one thing that sets it apart.",
    "- Do not repeat the title word for word, and never write a keyword list dressed up as a paragraph.",
    "- Use short labelled sections where they apply — PRODUCT DETAILS, MATERIAL, SIZING, CARE INSTRUCTIONS, WHAT YOU'LL RECEIVE — and include only the ones you actually have facts for.",
    "",
    "CATEGORY AND ATTRIBUTES.",
    "- Give the most specific accurate Etsy category for this actual product. Never a broad one where a specific one exists, and never pick for search volume over accuracy.",
    "- Give the Etsy attributes that exist for that category and that the product facts support. Attributes are structured data, not another place to put keywords.",
    "",
    "Etsy reads the whole listing, so distribute rather than repeat: the title carries the product and its strongest traits, the tags reach the searches the title cannot, attributes carry the structured facts, and the description gives the context.",
  ];

  if (requiredKeywords.length > 0) {
    const list = requiredKeywords.map((keyword) => `"${keyword}"`).join(", ");
    lines.push(
      "",
      "REQUIRED KEYWORDS.",
      `- Each of these terms must appear in the title, at least once in the description, and inside at least one tag: ${list}.`,
      "- Etsy matches title, description and tags separately, so a term present in only one of them is invisible in the other two.",
      "- These are real product facts a buyer searches by, not padding — work each one into a natural phrase, do not bolt it on as a bare label.",
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
          "Write the listing again with those terms worked in naturally, keeping every other rule — the title still has to read like a person wrote it, not like a keyword list with the missing terms appended.",
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
  const prompt = `Write an Etsy listing for a ${product.garment} in this niche:\n\n${niche}`;

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
  const product = findProduct(options.productId ?? DEFAULT_PRODUCT_ID);
  const prompt = [
    `This design is printed on a ${product.garment}. Write the Etsy listing for that ${product.garment}.`,
    "Describe what you actually see in the design — subject, wording, style, colour palette, typography, mood — and build the keywords from that.",
    `The design is the selling point, but the product being sold is the ${product.garment} itself.`,
    design.flattenedBackground
      ? `\nThis image was converted from a vector file with a transparent background. The flat ${design.flattenedBackground} backdrop was added by that conversion — it is not part of the design. Ignore it entirely: do not mention it, do not treat it as a colour of the artwork, and assume the design is printed on the ${product.garment} colour the seller chooses.`
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
