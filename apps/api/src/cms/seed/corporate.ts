/**
 * COM-1: import source of the dreampetroleum.com fragments (navigation, footer, SEO defaults),
 * through the same "Import into CMS" path as the BV fragments (ADR-020 D7). Used by the import and
 * nothing else; it never overwrites a fragment that exists (the CMS is the single source).
 *
 * Every text and value is taken from the live English site (https://dreampetroleum.com/en, header
 * and footer, read 2026-11-27); nothing is invented:
 *  - menu labels and their order are the live header's; COM-5: every link names its page by
 *    address and the import points it at the imported page (`corporateMenuTargets`), so it is a
 *    link while that page is live and text otherwise;
 *  - the footer's company text, head office address, phone, e-mail and social profiles are the live
 *    footer's (the e-mail address is the one the live page protects against scrapers);
 *  - the SEO defaults are the live site's title and its company overview sentence (the live pages
 *    have no meta description). No default Open Graph image: the corporate site has no media of
 *    its own yet (COM-2/COM-5).
 * Turkish versions are translations made in the admin (ML-2 "Create translation"), not seeds.
 * COM-2b adds the designed home page and the product portfolio (below); COM-3 the heading of the
 * news list.
 */
import { CORPORATE_NEWS_INDEX_LIVE } from "./corporate-pages.js";
import type {
  BvFooterMenuInput,
  BvNavMenuInput,
  BvSiteSeoContent,
  CmsNewsIndexContent,
  CorporateHomeContent,
  CorporateProductsContent,
} from "@dream/contracts";

const NONE = { type: "none" } as const;
const HOME = { type: "path", path: "/" } as const;

const PENDING = "Coming soon";

/**
 * COM-5: a page of the corporate site by its address. On import the API turns it into a reference
 * to the CMS page at that address (linked while it is live, text otherwise; never a broken link)
 * or "not ready" where the site has no such page yet (`corporateMenuTargets`).
 */
const at = (path: string) => ({ type: "path", path }) as const;

export const CORPORATE_NAV_SEED: BvNavMenuInput = {
  items: [
    { label: "Home", target: HOME },
    { label: "Products", target: at("/products") },
    {
      label: "Services",
      target: NONE,
      children: [
        { label: "Logistics", target: at("/logistics") },
        { label: "Energy Trading & Supply", target: at("/energy-trading") },
        { label: "Storage & Distribution", target: at("/storage-distribution") },
      ],
    },
    {
      label: "Company",
      target: NONE,
      children: [
        { label: "About Us", target: at("/about-us") },
        { label: "Strategic Partnership", target: at("/strategic-partnership") },
        { label: "Sustainability", target: at("/sustainability") },
        { label: "Our Team", target: at("/our-team") },
      ],
    },
    { label: "Blogs", target: at("/news") },
  ],
  contact: { label: "Contact Us", target: at("/contact") },
  noScriptLinks: [
    { label: "Home", target: HOME },
    { label: "Contact Us", target: at("/contact") },
  ],
  pendingNote: PENDING,
};

const OVERVIEW =
  "Dream Petroleum is a global energy and petroleum investment company operating across midstream and downstream markets.";

export const CORPORATE_FOOTER_SEED: BvFooterMenuInput = {
  headline: "Global Energy Markets",
  cta: {
    label: "Email Us",
    target: { type: "url", url: "mailto:info@dreampetroleum.com" },
  },
  intro: OVERVIEW,
  contact: {
    title: "Contact Us",
    company: "Dream Petroleum",
    addressLines: [
      { text: "Head Office Quasar Residence, Floor 15 Apt. 1507" },
      { text: "Büyükdere Ave. No:76, Fulya Neighborhood" },
      { text: "Mecidiyeköy, Şişli — Istanbul, Türkiye" },
    ],
    phone: { label: "+90 212 218 13 57", href: "tel:+902122181357", note: "Call Us" },
    email: {
      label: "info@dreampetroleum.com",
      href: "mailto:info@dreampetroleum.com",
      note: "Email Us",
    },
  },
  columns: [
    {
      title: "Core Areas",
      links: [
        { label: "Transportation, Storage & Wholesale Marketing", target: at("/logistics") },
        { label: "Energy Trading & Supply", target: at("/energy-trading") },
        { label: "Storage & Distribution", target: at("/storage-distribution") },
        // No page of their own: the product portfolio (its groups are sections of /products).
        { label: "Base Oils (Group I, II and III)", target: at("/products") },
        { label: "Petrochemical Products", target: at("/products") },
        { label: "Sea & Road Logistics", target: at("/logistics") },
      ],
    },
    {
      title: "Company Profile",
      links: [
        { label: "About Us", target: at("/about-us") },
        { label: "Our Team", target: at("/our-team") },
        { label: "Strategic Partnership", target: at("/strategic-partnership") },
        // The live site links "Core Strengths" to its About Us page.
        { label: "Core Strengths", target: at("/about-us") },
        { label: "Contact Us", target: at("/contact") },
      ],
    },
  ],
  social: [
    {
      network: "linkedin",
      label: "LinkedIn",
      url: "https://www.linkedin.com/company/dream-petroleum-kim-ltd-%C5%9Fti%CC%87",
    },
    { network: "instagram", label: "Instagram", url: "https://www.instagram.com/dream.petroleum" },
  ],
  copyright: "© 2026 - Dream Petroleum",
  // The site hides the Privacy Policy link where the policy is not published (DP-095).
  legal: [{ label: "Privacy Policy", target: { type: "path", path: "/privacy" } }],
  pendingNote: PENDING,
};

export const CORPORATE_SITE_SEO_SEED: Omit<BvSiteSeoContent, "defaultOgImage"> & {
  defaultOgImage: null;
} = {
  siteName: "Dream Petroleum",
  defaultTitle: "Dream Petroleum - Global Energy Markets",
  defaultDescription: OVERVIEW,
  defaultOgImage: null,
};

/**
 * COM-2b: the home page, from the live English home page (https://dreampetroleum.com/en, read
 * 2026-11-27) and, for the service cards, the introductions of the live service pages. Left out
 * on purpose (owner decisions 2026-11-27, DP-003): the "only official distributor" heading, every
 * counter (50+ countries, 100K+, 25K+, 16+, 100%), the customer testimonials, the FAQ (commercial
 * commitments: MOQ, LC, SGS, Incoterms), the "Flexible Trade Terms" strength (FOB/CIF terms), the
 * quality-standards sentence of the product block and the Storage & Distribution introduction
 * ("world-class terminal services": ownership to be confirmed). COM-7: the service cards link
 * their pages (COM-5; publish the pages before the home page) and carry the visual pack.
 */
/**
 * COM-7: the corporate visual pack v1 (registered CORPORATE assets). Generated, representative
 * industrial scenes: their alt texts say so, and no text presents them as the company's own
 * terminal, fleet or plant.
 */
export const CORPORATE_VISUALS = {
  energy: {
    image: "/media/visual-pack-v1/hero-energy-trading.webp",
    imageAlt: "Representative scene: a tanker moored beside an industrial harbour at dusk",
  },
  logistics: {
    image: "/media/visual-pack-v1/hero-logistics-supply.webp",
    imageAlt: "Representative scene: a road tanker and a tanker ship on a harbour quay",
  },
  storage: {
    image: "/media/visual-pack-v1/hero-storage-terminal.webp",
    imageAlt: "Representative scene: storage tanks and pipelines at dusk",
  },
  petrochemicals: {
    image: "/media/visual-pack-v1/hero-petrochemicals.webp",
    imageAlt: "Representative scene: process columns and pipework of a petrochemical plant",
  },
} as const;

export const CORPORATE_HOME_SEED: CorporateHomeContent = {
  hero: {
    eyebrow: "Dream Petroleum",
    title: "Global Energy Markets",
    intro:
      "Dream Petroleum is a global energy and petroleum investment company operating across midstream and downstream markets, delivering transparent and reliable execution across international trade networks.",
    primary: { label: "Contact Us", href: "/contact" },
    secondary: { label: "View Full Portfolio", href: "/products" },
    // COM-7: the four activity areas, with the live site's own texts (service cards and pages).
    slides: [
      {
        label: "Energy Trading",
        title: "Energy Trading & Supply",
        intro:
          "Connecting global energy resources with strategic market demand through disciplined trading and reliable supply chain execution.",
        ...CORPORATE_VISUALS.energy,
        cta: { label: "Energy Trading & Supply", href: "/energy-trading" },
      },
      {
        label: "Logistics & Supply",
        title: "We Make Transport Fast And Safe",
        intro: "We transport your products safely with our experienced staff and technology.",
        ...CORPORATE_VISUALS.logistics,
        cta: { label: "Logistics", href: "/logistics" },
      },
      {
        label: "Storage & Distribution",
        // The storage page's last-mile card: no statement about own terminals (DP-003).
        title: "Storage & Distribution",
        intro:
          "Fully integrated transport solutions moving product from storage facilities directly to end-user locations.",
        ...CORPORATE_VISUALS.storage,
        cta: { label: "Storage & Distribution", href: "/storage-distribution" },
      },
      {
        label: "Petrochemicals",
        title: "Petrochemical Product Supply",
        intro: "Aromatic, aliphatic, and solvent-based products supplied through trusted partners.",
        ...CORPORATE_VISUALS.petrochemicals,
        cta: { label: "View Full Portfolio", href: "/products#petrochemicals" },
      },
    ],
  },
  overview: {
    eyebrow: "Company Overview",
    title:
      "Our strategic position is built on deep industry expertise and a clear understanding of global petroleum trade dynamics.",
    body: "We allocate capital to infrastructure development and commercial petroleum marketing initiatives with a disciplined, governance-driven approach.\n\nWe operate with transparency, reliability, and professional execution across all markets.",
    highlights: [
      {
        title: "Mid & Downstream Focus",
        description:
          "Investment in transportation, storage, wholesale marketing, refining-related activities, and downstream distribution networks.",
      },
    ],
    link: null,
  },
  services: {
    eyebrow: "Services",
    title: "Reliable Delivery Across Global Markets",
    intro:
      "We provide integrated sea and road logistics capabilities with coordinated shipment control and timely product distribution.",
    items: [
      {
        title: "Energy Trading & Supply",
        description:
          "Connecting global energy resources with strategic market demand through disciplined trading and reliable supply chain execution.",
        href: "/energy-trading",
        ...CORPORATE_VISUALS.energy,
      },
      {
        title: "Logistics",
        description: "We transport your products safely with our experienced staff and technology.",
        href: "/logistics",
        ...CORPORATE_VISUALS.logistics,
      },
      {
        title: "Storage & Distribution",
        description: null,
        href: "/storage-distribution",
        ...CORPORATE_VISUALS.storage,
      },
      {
        title: "Sustainability",
        description:
          "Driving progress through responsible energy distribution and environmental stewardship.",
        href: "/sustainability",
        image: null,
        imageAlt: null,
      },
    ],
  },
  productGroups: {
    eyebrow: "Product Portfolio",
    title: "Base Oils and Petrochemical Supply Solutions",
    intro: null,
    items: [
      {
        title: "Group I Base Oils",
        description:
          "SN Series and Bright Stock grades for broad industrial and commercial applications.",
        href: "/products#base-oils-group1",
      },
      {
        title: "Group II Base Oils",
        description:
          "High viscosity index grades supporting high-performance lubricant formulations.",
        href: "/products#base-oils-group2",
      },
      {
        title: "Group III Base Oils",
        description:
          "High viscosity index grades refined using advanced hydrocracking technology, offering superior oxidation stability.",
        href: "/products#base-oils-group3",
      },
      {
        title: "Petrochemical Product Supply",
        description:
          "Aromatic, aliphatic, and solvent-based products supplied through trusted partners.",
        href: "/products#petrochemicals",
      },
    ],
    link: { label: "View Full Portfolio", href: "/products" },
  },
  strengths: {
    eyebrow: "Core Strengths",
    title: "Why Dream Petroleum?",
    items: [
      {
        title: "Global Market Access",
        description:
          "Strong supplier relationships and reliable commercial channels in international markets.",
      },
      {
        title: "Risk & Commercial Discipline",
        description:
          "Structured contracts, controlled exposure, and transparent financial frameworks.",
      },
      {
        title: "Operational Reliability",
        description:
          "Coordinated logistics, shipment control, and consistent supply chain execution.",
      },
      {
        title: "Structured Solutions",
        description:
          "Flexible structures tailored to partner requirements across varied shipment volumes.",
      },
      {
        title: "Long-Term Value",
        description:
          "Partnership model focused on continuity, reliability, and sustainable commercial growth.",
      },
    ],
  },
  // COM-7: the latest articles under the live blog's heading.
  news: {
    eyebrow: "Blogs",
    title: CORPORATE_NEWS_INDEX_LIVE.title,
    link: { label: "Blogs", href: "/news" },
  },
  cta: {
    title: "Transparent, Structured, and Long-Term Commercial Value",
    text: "Our approach combines disciplined risk management, flexible structures, and consistent execution across international midstream and downstream markets.",
    points: [
      { text: "Structured solutions aligned with global trade requirements." },
      { text: "Risk-managed contracts and controlled commercial exposure." },
      { text: "Reliable execution across sea and road logistics channels." },
      { text: "Long-term partnerships built on operational transparency." },
    ],
    button: { label: "Contact Us", href: "/contact" },
    ...CORPORATE_VISUALS.logistics,
  },
};

/**
 * COM-2b: the product portfolio, from the live English page (https://dreampetroleum.com/en/products,
 * read 2026-11-27), with the live anchors of its sections. Left out on purpose: the typical values
 * table (rows empty, so the site hides it, until its source is approved: DP-002), the grade
 * details of the live pop-up, and the certification, purity and guarantee statements that need a
 * source ("Quality Certified / ASTM Standards Compliant", "Highest Purity", "99% Purity", "Food
 * Grade Options", "tested ... to guarantee performance", the viscosity index figure "120+", the
 * "high purity" sentence of Group III, the "High-Purity" heading of the solvents and the FOB/CIF
 * statement). The COA request and the availability enquiry go to the contact page (/contact).
 */
export const CORPORATE_PRODUCTS_SEED: CorporateProductsContent = {
  intro: {
    eyebrow: null,
    title: "Product Portfolio",
    intro:
      "Supplying high-quality base oils, solvents, and petrochemical products across global energy markets.",
    ...CORPORATE_VISUALS.petrochemicals,
  },
  groups: [
    {
      anchor: "base-oils-group1",
      eyebrow: "Base Oils",
      title: "Group I",
      subtitle: "Base Oils (Solvent Neutral)",
      description:
        "Our Group I base oils are produced using solvent refining processes, providing excellent solubility and reliable performance for a wide range of industrial and marine lubricants.",
      items: [
        "SN 150",
        "SN 300",
        "SN 350",
        "SN 500",
        "SN 600",
        "SN 900",
        "SN 1250",
        "Bright Stock (BS)",
      ].map((name) => ({ name, type: null, description: null })),
      applicationsTitle: "Key Applications",
      applications: [
        { text: "General-purpose engine oils" },
        { text: "Marine lubricant formulations" },
        { text: "Industrial gear & transmission fluids" },
        { text: "Metalworking fluids & process oils" },
      ],
      link: null,
    },
    {
      anchor: "base-oils-group2",
      eyebrow: "Advanced Performance",
      title: "Group II",
      subtitle: "Base Oils (Hydro-treated)",
      description:
        "Produced through hydro-processing to remove impurities, Group II base oils offer superior oxidation stability, lower volatility, and higher viscosity index compared to Group I.",
      items: [
        {
          name: "HVI 4",
          type: null,
          description: "Light viscosity grade for high-performance automotive oils.",
        },
        {
          name: "HVI 6",
          type: null,
          description: "Balanced performance for premium industrial lubricants.",
        },
        {
          name: "HVI 8",
          type: null,
          description: "Heavy viscosity grade for heavy-duty machinery & gear systems.",
        },
      ],
      applicationsTitle: null,
      applications: [],
      link: null,
    },
    {
      anchor: "base-oils-group3",
      eyebrow: "High Technology & Performance",
      title: "Group III",
      subtitle: "Base Oils (Synthetic Blend)",
      description:
        "Group III base oils are formulated using severe hydrocracking technology, featuring an extra-high viscosity index.",
      items: ["Group III 2 cSt", "Group III 4 cSt", "Group III 6 cSt", "Group III 8 cSt"].map(
        (name) => ({ name, type: null, description: null }),
      ),
      applicationsTitle: null,
      applications: [],
      link: null,
    },
    {
      anchor: "solvents",
      eyebrow: null,
      title: "Hydrocarbon Solvents",
      subtitle: null,
      description:
        "We supply a range of aliphatic and aromatic solvents critical for paints, coatings, adhesives, and extraction industries.",
      items: [
        {
          name: "White Spirit",
          type: "Aliphatic",
          description:
            "Commonly known as mineral spirits, used as a paint thinner and mild degreaser.",
        },
        {
          name: "Hexane (C6)",
          type: "Aliphatic",
          description:
            "Critical for edible oil extraction and as a fast-evaporating adhesive solvent.",
        },
        {
          name: "Toluene",
          type: "Aromatic",
          description:
            "Clear aromatic solvent used in resins, plastics, and as high-octane fuel additive.",
        },
        {
          name: "Xylene",
          type: "Aromatic",
          description:
            "Versatile solvent for paints, rubber, and PET plastic production (para-xylene).",
        },
      ],
      applicationsTitle: null,
      applications: [],
      link: null,
    },
    {
      anchor: "petrochemicals",
      eyebrow: "Broad Spectrum Supply",
      title: "Specialty Petrochemicals",
      subtitle: null,
      description:
        "Depending on market availability, we supply a wide range of petrochemical intermediates and finished products to fulfill global demand.",
      items: [
        {
          name: "Polymers",
          type: null,
          description: "Polypropylene (PP), Polystyrene (PS), and Polyethylene (PE) resins.",
        },
        {
          name: "Intermediates",
          type: null,
          description: "Ethylene, Propylene, and various chemical building blocks.",
        },
      ],
      applicationsTitle: null,
      applications: [],
      link: { label: "Enquire for Availability", href: "/contact" },
    },
  ],
  typicalValues: {
    title: "Technical Analysis (Typical)",
    columnA: "Group I",
    columnB: "Group II",
    note: "Data provided as typical values for reference only. Specific COA available upon request.",
    // DP-002: no row until the source of the values is approved; the site hides the table.
    rows: [],
  },
  coa: {
    title: "Request a Certificate of Analysis (COA)",
    text: "Specific COA available upon request.",
    button: { label: "Request Documentation", href: "/contact" },
  },
};

/**
 * COM-3: the heading of the news list. The eyebrow is the menu label ("Blogs"); COM-5: the heading
 * and introduction are the live Blogs page's. The live page has no empty state: its two texts are
 * neutral editorial texts without any claim.
 */
export const CORPORATE_NEWS_INDEX_SEED: CmsNewsIndexContent = {
  eyebrow: "Blogs",
  // COM-5: the live Blogs page's heading and introduction.
  title: CORPORATE_NEWS_INDEX_LIVE.title,
  intro: CORPORATE_NEWS_INDEX_LIVE.intro,
  empty: {
    title: "No articles yet",
    text: "Articles will appear here once they are published.",
  },
};

export const CORPORATE_SEEDS: Readonly<Record<string, { title: string; content: unknown }>> = {
  "corporate.home": { title: "Home", content: CORPORATE_HOME_SEED },
  "corporate.products": { title: "Products", content: CORPORATE_PRODUCTS_SEED },
  "corporate.news-index": { title: "News", content: CORPORATE_NEWS_INDEX_SEED },
  "corporate.site-nav": { title: "Navigation", content: CORPORATE_NAV_SEED },
  "corporate.site-footer": { title: "Footer", content: CORPORATE_FOOTER_SEED },
  "corporate.site-seo": { title: "SEO defaults", content: CORPORATE_SITE_SEO_SEED },
};
