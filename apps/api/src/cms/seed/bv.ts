/**
 * Import source of the BV site's designed page and fragments (CMS S2, DP-134, ADR-020 D7).
 *
 * Converted once, word for word, from apps/web-bv/content/*.ts (main dfada0e, 2026-11-13); the
 * sources, caveats and claim rules recorded in those files are in docs/cms/bv-content-sources.md.
 * Since S2 the site renders these pages only from the CMS: this file is used by the import and
 * nothing else, and it never overwrites a page that exists (the CMS is the single source).
 *
 * One change against the files: the phone links without JavaScript point at "/" instead of the
 * former demo route.
 */
import type {
  BvFooterContent,
  BvHomeContent,
  BvNavContent,
  BvNewsIndexContent,
} from "@dream/contracts";

export const BV_HOME_SEED: BvHomeContent = {
  hero: {
    brand: "ICCSYN BASE OILS",
    tagline: "Purity in Motion.",
    scrollCue: "Scroll to explore",
    cta: {
      label: "Explore ICCSYN Products",
      href: null,
      disabledNote: "The product page is not connected in this demo.",
    },
    supply: "Supplied in Europe by Dream Petroleum B.V.",
    legal:
      "ICCSYN® is a registered trademark of its respective owner. Temporary images and footage, not a product sample.",
    mediaAlt:
      "A nearly colourless base oil pouring into a glass laboratory beaker, with amber light reflecting off the glass.",
    applications: [
      {
        title: "Passenger & heavy-duty engine oils",
        description: "A base stock for low-viscosity 0W and 5W grades.",
        image: "/media/iccsyn-cards/engine-valvetrain.webp",
      },
      {
        title: "Transmission & gear oils",
        description: "Used for ATF, axle and industrial gear oils.",
        image: "/media/iccsyn-cards/temp/transmission-gear.webp",
      },
      {
        title: "Hydraulic fluids",
        description: "For high-VI fluids in wide-temperature systems.",
        image: "/media/iccsyn-cards/hydraulic-power-unit.webp",
      },
      {
        title: "Compressor & turbine oils",
        description: "For oils built around long life and low deposits.",
        image: "/media/iccsyn-cards/turbine-compressor-rotor.webp",
      },
      {
        title: "Industrial lubricants & greases",
        description: "For premium synthetic blends.",
        image: "/media/iccsyn-cards/temp/industrial.webp",
      },
      {
        title: "Specialty fluids",
        description:
          "Such as dielectric and immersion-cooling fluids; grade suitability must be confirmed by testing.",
        image: "/media/iccsyn-cards/temp/specialty.webp",
      },
    ],
  },
  productGroups: {
    label: "Product groups",
    disclosure:
      "Temporary low-resolution animation. Representative only: colour and clarity must be confirmed with a product sample.",
    groups: [
      {
        anchor: "group-1",
        nameWord: "Group",
        nameNumeral: "I",
        eyebrow: "Base oils",
        description:
          "Solvent-refined base oils in eight catalogue grades, from SN 150 to Bright Stock.",
        note: null,
        samples: "SN 150 / SN 500 / Bright Stock",
        cta: {
          label: "Explore Group I",
          href: "https://dreampetroleumbv.com/en/products?category=base-oil-group-i",
        },
        animation: "/media/iccsyn-groups/temp/group-1-loop.gif",
        poster: "/media/iccsyn-groups/temp/group-1-poster.webp",
        mediaAlt: "Representative animation of oil running over an engine camshaft.",
      },
      {
        anchor: "group-2",
        nameWord: "Group",
        nameNumeral: "II",
        eyebrow: "Base oils",
        description:
          "Hydrotreated base oils in eleven catalogue grades, from 70N to 600N, plus 90BS and HVI 4, 6 and 8.",
        note: null,
        samples: "100N / 150N / 500N",
        cta: {
          label: "Explore Group II",
          href: "https://dreampetroleumbv.com/en/products?category=base-oil-group-ii",
        },
        animation: "/media/iccsyn-groups/temp/group-2-loop.gif",
        poster: "/media/iccsyn-groups/temp/group-2-poster.webp",
        mediaAlt: "Representative animation of oil moving through a hydraulic sight glass.",
      },
      {
        anchor: "group-3",
        nameWord: "Group",
        nameNumeral: "III",
        eyebrow: "ICCSYN CTL base oils",
        description:
          "Four ICCSYN grades in the Group III range. Technical data and sample reports are listed where available.",
        note: null,
        samples: "ICCSYN 2 / 4 / 6 / 8",
        cta: {
          label: "Explore Group III",
          href: "https://dreampetroleumbv.com/en/products?category=base-oil-group-iii",
        },
        animation: "/media/iccsyn-groups/temp/group-3-loop.gif",
        poster: "/media/iccsyn-groups/temp/group-3-poster.webp",
        mediaAlt: "Representative animation of a clear fluid flowing over gear teeth.",
      },
      {
        anchor: "group-3-plus",
        nameWord: "Group",
        nameNumeral: "III+",
        eyebrow: "ICCSYN CTL base oils",
        description:
          "ICCSYN 6 and 10 combine a high viscosity index with low volatility, for automotive and industrial lubricant formulations.",
        note: "Group III+ is a commercial classification in our catalogue, not a separate API group.",
        samples: "ICCSYN 6 / 10",
        cta: {
          label: "Explore Group III+",
          href: "https://dreampetroleumbv.com/en/products?category=base-oil-group-iii-plus",
        },
        animation: "/media/iccsyn-groups/temp/group-3-plus-loop.gif",
        poster: "/media/iccsyn-groups/temp/group-3-plus-poster.webp",
        mediaAlt: "Representative animation of a clear fluid flowing across turbine blades.",
      },
    ],
  },
  services: {
    eyebrow: "Our Services",
    title: "Specialized Petrochemical Services",
    intro:
      "From global energy trading to last-mile distribution — we manage the full supply chain with precision and reliability.",
    disclosure:
      "Illustrative CGI images. They do not show Dream Petroleum facilities, vessels or vehicles.",
    items: [
      {
        anchor: "energy-trading-supply",
        title: "Energy Trading & Supply",
        description:
          "Deep market expertise providing a competitive edge in international energy and chemical markets. FOB and CIF structures, risk-managed commercial execution.",
        shortDescription:
          "Deep market expertise providing a competitive edge in international energy and chemical markets.",
        cta: {
          label: "Learn More",
          href: "/energy-trading",
        },
        imageAlt:
          "Illustrative CGI render of a tanker and a storage terminal at night under a glowing world map.",
        desktopImage: "/media/services-showcase/energy-trading-supply-desktop.webp",
        desktopPosition: "100% 30%",
        mobileImage: "/media/services-showcase/energy-trading-supply-mobile.webp",
        mobilePosition: "50% 30%",
      },
      {
        anchor: "storage-distribution",
        title: "Storage & Distribution",
        description:
          "World-class terminal services and integrated distribution from Rotterdam — high-capacity bulk liquid storage, specialty warehousing, and last-mile delivery.",
        shortDescription:
          "World-class terminal services and integrated distribution from Rotterdam.",
        cta: {
          label: "Learn More",
          href: "/storage-distribution",
        },
        imageAlt:
          "Illustrative CGI render of storage tanks, a road tanker loading bay and an amber-lit pipeline at night.",
        desktopImage: "/media/services-showcase/storage-distribution-desktop.webp",
        desktopPosition: "100% 30%",
        mobileImage: "/media/services-showcase/storage-distribution-mobile.webp",
        mobilePosition: "50% 30%",
      },
      {
        anchor: "logistics",
        title: "Logistics",
        description:
          "Integrated sea and road logistics capabilities with coordinated shipment control and timely product distribution to 50+ countries across all major markets.",
        shortDescription:
          "Integrated sea and road logistics capabilities with coordinated shipment control and timely product distribution.",
        cta: {
          label: "Learn More",
          href: "/logistics",
        },
        imageAlt:
          "Illustrative CGI render of a tanker at a port crane and a road tanker on a curved quay at dusk.",
        desktopImage: "/media/services-showcase/logistics-desktop.webp",
        desktopPosition: "100% 30%",
        mobileImage: "/media/services-showcase/logistics-mobile.webp",
        mobilePosition: "50% 30%",
      },
    ],
  },
  ctl: {
    eyebrow: "CTL Technology",
    title: "From Synthesis Gas to ICCSYN Base Oils",
    document: {
      label: "CTL Technology Overview (PDF)",
      href: "https://dreampetroleumbv.com/assets/specs/iccsyn-ctl-technology-overview.pdf",
    },
    stages: [
      {
        anchor: "industrial-process",
        title: "Industrial Process",
        description:
          "Coal-to-Liquid (CTL) technology builds base oil molecules from synthesis gas through Fischer–Tropsch synthesis. The process converts coal into synthesis gas, then into paraffinic wax.",
        disclosure: "Representative industrial facility, not a verified CTL plant.",
        image: "/media/ctl-technology/industrial-process.webp",
        imageAlt: "Representative image of an industrial processing facility lit at dusk.",
        positionDesktop: "45% 50%",
        positionMobile: "40% 50%",
      },
      {
        anchor: "molecular-engineering",
        title: "Molecular Engineering",
        description:
          "Fischer–Tropsch synthesis produces long, linear paraffins (wax). Hydro-isomerisation adds short side branches, turning this wax into isoparaffinic base stock.",
        disclosure: "Abstract CGI of a molecule, not a reaction diagram.",
        image: "/media/ctl-technology/molecular-visualization.webp",
        imageAlt:
          "Abstract CGI of glass spheres joined by rods, resembling a molecule, in amber light.",
        positionDesktop: "45% 50%",
        positionMobile: "45% 50%",
      },
      {
        anchor: "clear-base-oil",
        title: "Clear Base Oil",
        description:
          "The result is a water-white, almost pure isoparaffinic base stock. Hebei Feitian produces ICCSYN at its Xinji refinery; Dream Petroleum B.V. supplies European lubricant blenders.",
        disclosure:
          "Illustrative image, not a product sample. The oil is colourless; the amber is only reflected light.",
        image: "/media/ctl-technology/clear-base-oil.webp",
        imageAlt:
          "Illustrative image of a clear, colourless liquid poured into a laboratory beaker, with amber light reflected on the glass.",
        positionDesktop: "50% 50%",
        positionMobile: "50% 50%",
      },
    ],
  },
  applications: {
    eyebrow: "Applications",
    title: "Potential Application Concepts",
    status: "Pending Technical Validation",
    intro: "Three visual ideas for discussion. None of them is a confirmed use of ICCSYN.",
    validation: {
      title: "What validation would require",
      intro: "No concept above becomes an application until each of these is in place.",
      requirements: [
        {
          text: "An exact product-grade Technical Data Sheet (TDS)",
        },
        {
          text: "Written manufacturer approval for the intended application",
        },
        {
          text: "Regulatory compliance review, where relevant",
        },
      ],
      note: "Group III base oils are lubricant base stocks, not by default raw materials for polymer resins.",
      cta: {
        label: "Contact Dream Petroleum",
        href: "/contact",
      },
    },
    scenes: [
      {
        anchor: "transparent-polymers",
        title: "Transparent Polymers",
        description:
          "A visual study of clear containers, film, tubing and moulded parts. It frames a question to explore, not an established use.",
        disclosure:
          "AI-generated concept image. Not a real product and not a verified ICCSYN application.",
        cta: {
          label: "Discuss this concept",
          href: "/contact",
        },
        image: "/media/applications/transparent-polymers-1448.webp",
        imageSmall: "/media/applications/transparent-polymers-828.webp",
        imageAlt:
          "AI-generated concept image of clear plastic containers, a film roll, pouches, tubing and moulded parts on a dark reflective surface, with amber light.",
        positionDesktop: "50% 42%",
      },
      {
        anchor: "baby-care-concept",
        title: "Baby Care Concepts",
        description:
          "A creative concept only. No suitability for baby products, medical use or food contact is stated or implied.",
        disclosure:
          "AI-generated concept image. Not a real product and not a verified ICCSYN application.",
        cta: {
          label: "See what validation requires",
          href: "#applications-validation",
        },
        image: "/media/applications/baby-care-concept-1448.webp",
        imageSmall: "/media/applications/baby-care-concept-828.webp",
        imageAlt:
          "AI-generated concept image of a clear baby bottle, cup, pacifier and teething ring on a dark reflective surface, with amber light.",
        positionDesktop: "50% 30%",
      },
      {
        anchor: "personal-care-packaging",
        title: "Personal Care Packaging",
        description:
          "A visual concept of clear bottles, pumps and jars. It is not evidence of use in packaging or cosmetic formulations.",
        disclosure:
          "AI-generated concept image. Not a real product and not a verified ICCSYN application.",
        cta: {
          label: "See how ICCSYN is made",
          href: "#ctl-technology",
        },
        image: "/media/applications/personal-care-packaging-1448.webp",
        imageSmall: "/media/applications/personal-care-packaging-828.webp",
        imageAlt:
          "AI-generated concept image of clear pump bottles, a cream jar, caps and spray bottles on a dark reflective surface, with amber light.",
        positionDesktop: "50% 34%",
      },
    ],
  },
};

export const BV_NAV_SEED: BvNavContent = {
  items: [
    {
      label: "Home",
      href: "#top",
    },
    {
      label: "Products",
      href: "/products",
    },
    {
      label: "Services",
      href: "#services",
    },
    {
      label: "Company",
      href: "/about-us",
    },
    {
      label: "Blogs",
      href: "/news",
    },
    {
      label: "Contact Us",
      href: "/contact",
    },
  ],
  contact: {
    label: "Contact",
    href: "/contact",
  },
  noScriptLinks: [
    {
      label: "Home",
      href: "#top",
    },
    {
      label: "Products",
      href: "/products",
    },
    {
      label: "Services",
      href: "/#services",
    },
    {
      label: "CTL Technology",
      href: "/#ctl-technology",
    },
    {
      label: "Applications",
      href: "/#applications",
    },
  ],
  pendingNote: "This page isn't ready yet.",
};

export const BV_FOOTER_SEED: BvFooterContent = {
  headline: "Let’s Move Energy Forward.",
  cta: {
    label: "Get in Touch",
    href: "/contact",
  },
  intro:
    "Dream Petroleum BV is a global leader in the trading and distribution of high-quality base oils and petrochemical products. We add value to the energy sector through our strategic Rotterdam-based logistics network.",
  contact: {
    title: "Contact Us",
    company: "Dream Petroleum B.V.",
    addressLines: [
      {
        text: "Herengracht 420",
      },
      {
        text: "1017 AMSTERDAM",
      },
    ],
    phone: {
      label: "020 210 13 50",
      href: "tel:+31202101350",
      note: "Mon–Fri 08:30–18:30",
    },
    email: {
      label: "info@dreampetroleumbv.com",
      href: "mailto:info@dreampetroleumbv.com",
      note: "We reply within 24h",
    },
  },
  columns: [
    {
      title: "Products",
      links: [
        {
          label: "Base Oils (Group I, II & III)",
          href: "/products",
        },
        {
          label: "High-Quality Solvents",
          href: "/products",
        },
        {
          label: "Petrochemicals",
          href: "/products",
        },
      ],
    },
    {
      title: "Services",
      links: [
        {
          label: "Sea & Road Logistics",
          href: "/logistics",
        },
        {
          label: "Energy Trading & Supply",
          href: "/energy-trading",
        },
        {
          label: "Storage & Distribution",
          href: "/storage-distribution",
        },
      ],
    },
    {
      title: "Company & Resources",
      links: [
        {
          label: "About Us",
          href: "/about-us",
        },
        {
          label: "Strategic Partnership",
          href: "https://dreampetroleumbv.com/en/strategic-partnership",
        },
        {
          label: "Sustainability",
          href: "https://dreampetroleumbv.com/en/sustainability",
        },
        {
          label: "Leadership Team",
          href: "https://dreampetroleumbv.com/en/our-team",
        },
        {
          label: "News & Insights",
          href: "https://dreampetroleumbv.com/en/blog",
        },
        {
          label: "Contact Us",
          href: "/contact",
        },
      ],
    },
  ],
  copyright: "© 2026 Dream Petroleum BV. All rights reserved.",
  legal: [
    {
      label: "Privacy Policy",
      href: "/privacy",
    },
    {
      label: "Terms & Conditions",
      href: null,
    },
  ],
  pendingNote: "page not available yet",
};

/**
 * DP-153: the heading of the news list, as the site showed it in code during DP-020 (its NEWS_UI).
 */
export const BV_NEWS_INDEX_SEED: BvNewsIndexContent = {
  eyebrow: "News",
  title: "News and insights",
  intro: "Updates from Dream Petroleum BV on energy trading, logistics and the markets we serve.",
  empty: {
    title: "No articles yet",
    text: "Our first articles are on their way. Please check back soon.",
  },
};

/** Import seeds by registry key, with the page title the import gives them. */
export const CMS_SEEDS: Readonly<Record<string, { title: string; content: unknown }>> = {
  "bv.home": { title: "Home", content: BV_HOME_SEED },
  "bv.site-nav": { title: "Navigation", content: BV_NAV_SEED },
  "bv.site-footer": { title: "Footer", content: BV_FOOTER_SEED },
  "bv.news-index": { title: "News", content: BV_NEWS_INDEX_SEED },
};
