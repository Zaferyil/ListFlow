/**
 * The blanks this shop prints on.
 *
 * Every spec here is taken from the manufacturer's own sheet, not from the
 * model's memory — fabric content is the one thing on a listing a buyer can
 * hold you to, and it is exactly the kind of detail a model will invent
 * plausibly and wrongly. The listing prompt is told it may rely on these facts,
 * which is what lifts the "never state attributes you weren't given" rule for
 * this garment.
 *
 * Sources are noted per product. Re-check them when a supplier changes a spec.
 */

export type Audience = "adult" | "youth";

export interface Product {
  id: string;
  /** Shown on the selector button. */
  label: string;
  brand: string;
  sku: string;
  /** The noun to use for the garment in copy, e.g. "t-shirt". */
  garment: string;
  audience: Audience;
  /** Fabric content for standard/solid colorways. */
  composition: string;
  weight: string;
  fit: string;
  /** Construction details worth mentioning in a description. */
  features: string[];
  /**
   * Set when fiber content changes by colorway. The prompt uses this to stop
   * the model claiming a blanket "100% cotton" across every colour.
   */
  colorCaveat?: string;
  /** Etsy "materials" values — facts, so they are set from here, not generated. */
  materials: string[];
  /** Terms that must appear in title, description and tags for this blank. */
  requiredKeywords: string[];
  /**
   * Colourways offered for this blank, used to prefill the Etsy variation
   * editor. Left empty where the range has not been confirmed — a wrong colour
   * list would go straight onto a live listing.
   */
  colors?: string[];
  source: string;
}

export const PRODUCTS: Product[] = [
  {
    id: "cc-1717",
    label: "Comfort Colors 1717",
    brand: "Comfort Colors",
    sku: "1717",
    garment: "t-shirt",
    audience: "adult",
    composition: "100% US ring-spun cotton, 20 singles",
    weight: "6.1 oz/yd²",
    fit: "relaxed unisex fit with a seamless body",
    features: [
      "garment-dyed and soft-washed for a lived-in feel",
      "preshrunk through the garment-dye process, so it holds its size",
      "top-stitched classic-width rib collar",
      "twill-taped neck and shoulders",
      "double-needle collar and bottom hems",
    ],
    materials: ["ring-spun cotton", "garment-dyed cotton", "100% cotton"],
    requiredKeywords: ["Comfort Colors"],
    colors: [
      "Black",
      "Blue Spruce",
      "Blue Jean",
      "Blossom",
      "Chalky Mint",
      "Crunchberry",
      "Espresso",
      "Crimson",
      "Flo Blue",
      "Graphite",
      "Gray",
      "Ice Blue",
      "Ivory",
      "Navy",
      "Orchid",
      "Pepper",
      "Red",
      "Washed Denim",
      "Watermelon",
      "White",
      "Moss",
      "Violet",
      "Yam",
      "Seafoam",
    ],
    source: "https://www.ssactivewear.com/p/comfort_colors/1717",
  },
  {
    id: "gildan-64000",
    label: "Gildan 64000 Softstyle",
    brand: "Gildan",
    sku: "64000",
    garment: "t-shirt",
    audience: "adult",
    composition: "100% preshrunk ring-spun cotton, 30 singles",
    weight: "4.5 oz/yd²",
    fit: "semi-fitted, lighter and softer than a heavyweight tee",
    features: [
      "seamless double-needle 3/4in collar",
      "double-needle sleeve and bottom hems",
      "quarter-turned to eliminate a centre crease",
      "high stitch density for a smooth print surface",
    ],
    colorCaveat:
      "Solid colours are 100% cotton. Sport Grey and Antique colours are 90/10 cotton/polyester, Graphite Heather is 50/50, and heather colours and Blackberry are 35/65 cotton/polyester.",
    materials: ["ring-spun cotton", "cotton"],
    requiredKeywords: [],
    source: "https://retail.gildan.com/softstyle-adult-t-shirt/",
  },
  {
    id: "gildan-18500",
    label: "Gildan 18500 Hoodie",
    brand: "Gildan",
    sku: "18500",
    garment: "hooded sweatshirt",
    audience: "adult",
    composition: "50/50 cotton/polyester, 20 singles",
    weight: "8.0 oz/yd²",
    fit: "classic fit",
    features: [
      "double-lined hood with a colour-matched drawcord",
      "front pouch pocket",
      "1x1 rib with spandex at the cuffs and waistband",
      "finer face yarn for a smoother print surface and less pilling",
      "double-needle stitching throughout",
    ],
    colorCaveat:
      "Most colours are 50/50 cotton/polyester. Heather Dark Green, Heather Dark Maroon, Heather Dark Navy, Heather Deep Royal and Heather Scarlet Red are 60/40 polyester/cotton.",
    materials: ["cotton", "polyester", "cotton polyester blend fleece"],
    requiredKeywords: [],
    source: "https://www.ssactivewear.com/p/gildan/18500",
  },
  {
    id: "awdis-jh030",
    label: "AWDis JH030 Sweatshirt",
    brand: "AWDis",
    sku: "JH030",
    garment: "sweatshirt",
    audience: "adult",
    composition: "80% ring-spun cotton, 20% polyester",
    weight: "280 gsm",
    fit: "crew neck with set-in sleeves and a stylish fit",
    features: [
      "brushed inner fleece",
      "taped neck",
      "ribbed collar, cuffs and hem",
      "twin-needle stitching",
      "soft cotton-faced fabric for a clean print surface",
    ],
    materials: ["ring-spun cotton", "polyester", "brushed fleece"],
    requiredKeywords: [],
    source: "https://awdis.com/products/awdis-sweat-jh030/",
  },
  {
    id: "gildan-2400",
    label: "Gildan 2400 Long Sleeve",
    brand: "Gildan",
    sku: "2400",
    garment: "long sleeve t-shirt",
    audience: "adult",
    composition: "100% cotton preshrunk jersey knit, 18 singles",
    weight: "6.0 oz/yd²",
    fit: "classic fit with ribbed cuffs",
    features: [
      "seamless double-needle collar",
      "rib cuffs",
      "double-needle bottom hem",
      "taped neck and shoulders",
      "quarter-turned to eliminate a centre crease",
    ],
    colorCaveat:
      "Most colours are 100% cotton. Ash Grey is 99/1 cotton/polyester, Sport Grey is 90/10, and Dark Heather and safety colours are 50/50 cotton/polyester.",
    materials: ["cotton", "preshrunk cotton jersey"],
    requiredKeywords: [],
    source: "https://www.ssactivewear.com/p/gildan/2400",
  },
  {
    id: "gildan-5000b",
    label: "Gildan 5000B Youth Tee",
    brand: "Gildan",
    sku: "5000B",
    garment: "t-shirt",
    audience: "youth",
    composition: "100% cotton, 20 singles",
    weight: "5.3 oz/yd²",
    fit: "classic youth fit",
    features: [
      "preshrunk jersey knit",
      "double-needle stitching at the neckline, sleeves and bottom hem",
      "shoulder-to-shoulder taping",
    ],
    colorCaveat:
      "Most colours are 100% cotton. Sport Grey is 90/10 cotton/polyester, Ash is 99/1, and Dark Heather, neon and safety colours are 50/50 cotton/polyester.",
    materials: ["cotton", "preshrunk cotton jersey"],
    requiredKeywords: [],
    source: "https://www.ssactivewear.com/p/gildan/5000b",
  },
  {
    id: "cc-9018",
    label: "Comfort Colors 9018 Youth",
    brand: "Comfort Colors",
    sku: "9018",
    garment: "t-shirt",
    audience: "youth",
    composition: "100% ring-spun cotton, 20 singles",
    weight: "6.1 oz/yd²",
    fit: "classic tubular youth fit",
    features: [
      "garment-dyed for a lived-in feel with almost no shrinkage",
      "top-stitched classic-width rib collar",
      "shoulder-to-shoulder twill tape",
      "sewn with 100% cotton thread",
      "meets OEKO-TEX Standard 100",
    ],
    materials: ["ring-spun cotton", "garment-dyed cotton", "100% cotton"],
    requiredKeywords: ["Comfort Colors"],
    source: "https://www.comfortcolors.com/us/en/9018-heavyweight-youth-t-shirt-en_us/",
  },
  {
    id: "ceramic-heart-ornament",
    label: "Ceramic Heart Ornament",
    brand: "Ceramic",
    sku: "heart-3in",
    garment: "ceramic ornament",
    audience: "adult",
    composition: "100% ceramic",
    weight: "lightweight ceramic",
    fit: '3.0" (7.62 cm) heart shape',
    features: [
      "high-quality ceramic construction",
      "heart-shaped design with hanging loop",
      "smooth gloss finish for optimal printing",
      "1-side and 2-side printing options",
      "white ceramic with excellent print quality",
    ],
    materials: ["ceramic", "glazed ceramic"],
    requiredKeywords: [],
    colors: ["White"],
    source: "Ceramic ornament supplier",
  },
  {
    id: "ceramic-round-ornament",
    label: "Ceramic Round Ornament",
    brand: "Ceramic",
    sku: "round-2.85in",
    garment: "ceramic ornament",
    audience: "adult",
    composition: "100% ceramic",
    weight: "lightweight ceramic",
    fit: '2.85" (7.24 cm) round shape',
    features: [
      "high-quality ceramic construction",
      "classic round design with hanging loop",
      "smooth gloss finish for optimal printing",
      "1-side and 2-side printing options",
      "white ceramic with excellent print quality",
    ],
    materials: ["ceramic", "glazed ceramic"],
    requiredKeywords: [],
    colors: ["White"],
    source: "Ceramic ornament supplier",
  },
];

export const DEFAULT_PRODUCT_ID = PRODUCTS[0].id;

export function findProduct(id: string | undefined | null): Product {
  return PRODUCTS.find((product) => product.id === id) ?? PRODUCTS[0];
}

/**
 * Terms the listing must carry for a given blank. Routes use this so the
 * warnings check the same set the generator was told to satisfy.
 */
export function requiredKeywordsFor(productId: string | undefined): string[] {
  return findProduct(productId).requiredKeywords;
}

/** The manufacturer facts the model is allowed to state, as prompt lines. */
export function productFacts(product: Product): string[] {
  const lines = [
    `- Blank: ${product.brand} ${product.sku}, a ${product.audience === "youth" ? "youth" : "adult unisex"} ${product.garment}.`,
    `- Fabric: ${product.composition}, ${product.weight}.`,
    `- Fit: ${product.fit}.`,
    ...product.features.map((feature) => `- ${feature[0].toUpperCase()}${feature.slice(1)}.`),
  ];

  if (product.colorCaveat) {
    lines.push(
      `- Colour caveat: ${product.colorCaveat} Because of this, do not claim one blanket fiber content for every colour — either describe the standard colours and note that heather and grey shades are a blend, or keep fiber content out of the title and tags.`,
    );
  }

  if (product.audience === "youth") {
    lines.push(
      "- This is a youth garment. Write for the adult buying it for a child — parents, grandparents, teachers — and use kids/youth wording in the keywords, not adult sizing.",
    );
  }

  return lines;
}
