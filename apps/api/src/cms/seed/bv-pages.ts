/**
 * Import source of the BV content pages (DP-135, first package): About Us, Energy Trading & Supply,
 * Logistics, Storage & Distribution. Read from https://dreampetroleumbv.com/en on 2026-11-13; the
 * wording is the live site's, word for word, with these deliberate changes (docs/cms/
 * bv-content-pages.md lists them and the open questions for Dream Petroleum):
 *
 *  - "Dream Chemicals" (a leftover brand on the live inner pages) reads "Dream Petroleum BV";
 *  - the unsourced "Market growth tracking: +12% consistent trajectory" bullet is left out;
 *  - About Us: the active countries are listed under the four target markets the page names, and
 *    the four market photos are not used (stock photos unrelated to the markets);
 *  - service pages open with the site's existing illustrative CGI renders, with their disclosure;
 *  - buttons that pointed at the legacy contact-us.html go to the contact page here (/contact).
 *
 * Contact (DP-150): the live page's texts; the phone, e-mail and address are not repeated here, the
 * page shows them from the published footer. The live form sends nothing yet here (DP-151).
 *
 * Used by the import only; it never overwrites a page that exists (ADR-020 D7).
 */
import type { CmsSeo } from "@dream/contracts";

const CONTACT = "/contact";
const CGI_NOTE =
  "Illustrative CGI image. It does not show Dream Petroleum facilities, vessels or vehicles.";
const PARTNER_CTA = {
  type: "cta",
  title: "Partner With Us",
  text: "Explore strategic opportunities with Dream Petroleum BV.",
  button: { label: "Get In Touch", href: CONTACT },
};

export interface CmsPageSeed {
  slug: string;
  title: string;
  seo: CmsSeo;
  content: { sections: ({ id: string; type: string } & Record<string, unknown>)[] };
}

const seo = (title: string): CmsSeo => ({ title, description: null, noindex: false });

export const CMS_PAGE_SEEDS: Readonly<Record<string, CmsPageSeed>> = {
  "bv.contact": {
    slug: "contact",
    title: "Contact Us",
    seo: {
      title: "Contact Us | Dream Petroleum BV",
      description:
        "Have a question, a trading enquiry, or want to explore a partnership? Our team is ready to assist.",
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "contact-hero",
          type: "hero",
          eyebrow: "Get In Touch",
          title: "Contact Us",
          intro:
            "Have a question, a trading enquiry, or want to explore a partnership? Our team is ready to assist.",
          cta: null,
        },
        {
          id: "contact-details",
          type: "contact",
          title: "We Are Always Ready to Help You",
          intro: null,
          formTitle: "Send Us a Message",
          formNote:
            "This form cannot send messages yet. Please call us or write to us by e-mail in the meantime.",
        },
      ],
    },
  },
  "bv.about-us": {
    slug: "about-us",
    title: "About Us",
    seo: seo("About Us | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "about-hero",
          type: "hero",
          eyebrow: "Company",
          title: "About Us",
          intro:
            "Connecting global energy and chemical markets with excellence — from the heart of Rotterdam.",
          cta: null,
        },
        {
          id: "about-intro",
          type: "text",
          title: "Connecting Global Markets with Excellence",
          body: "Dream Petroleum BV connects global energy and chemical markets through reliable trading, strategic sourcing, and efficient supply solutions. Operating across key international markets, we facilitate the movement of essential chemical products from trusted refineries to end users — ensuring continuity, flexibility, and performance at every stage of the supply chain.",
        },
        {
          id: "about-mission",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Our Mission",
              description:
                "Dream Petroleum BV strives to achieve excellence in the production of base oils and speciality products in key end markets globally.",
              link: null,
            },
            {
              title: "Our Vision",
              description:
                "Our vision is to be a leading supplier of premium base oils and speciality products in key end markets — setting global benchmarks in quality and reliability.",
              link: null,
            },
          ],
        },
        {
          id: "about-markets",
          type: "specList",
          title: "Key Target Markets",
          intro: null,
          items: [
            { term: "Europe", detail: "Germany, Hungary, Poland, Spain, Netherlands, Belgium" },
            { term: "Middle East", detail: "UAE, Saudi Arabia, Kuwait, Bahrain, Qatar" },
            { term: "Asia", detail: "South Korea, China, Thailand, Taiwan" },
            { term: "Americas", detail: "USA" },
          ],
          link: null,
        },
        { id: "about-cta", ...PARTNER_CTA },
      ],
    },
  },
  "bv.energy-trading": {
    slug: "energy-trading",
    title: "Energy Trading & Supply",
    seo: seo("Energy Trading & Supply | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "trading-open",
          type: "split",
          eyebrow: "Energy Trading & Supply",
          title: "Navigating Global Energy Markets",
          body: "Dream Petroleum BV serves as a premier global partner in the trading and distribution of high-quality base oils and petrochemical products. We connect global energy and chemical markets through reliable trading, strategic sourcing, and efficient supply solutions.",
          image: "/media/services-showcase/energy-trading-supply-desktop.webp",
          imageAlt:
            "Illustrative CGI render of a tanker and a storage terminal at night under a glowing world map.",
          imageNote: CGI_NOTE,
        },
        {
          id: "trading-quote",
          type: "quote",
          text: "Structured solutions aligned with global trade requirements — delivering transparent, long-term commercial value.",
          source: null,
        },
        {
          id: "trading-capabilities",
          type: "specList",
          title: "Our Trading Capabilities",
          intro: null,
          items: [
            {
              term: "FOB (Free On Board) and CIF (Cost, Insurance, Freight) structures",
              detail: null,
            },
            { term: "Risk-managed contracts and controlled commercial exposure", detail: null },
            { term: "Long-term supply agreements and spot trading", detail: null },
            { term: "24/7 operations and global market monitoring", detail: null },
          ],
          link: null,
        },
        {
          id: "trading-access",
          type: "cards",
          title: "Strategic Market Access",
          intro:
            "Our approach combines disciplined risk management, flexible structures, and consistent execution across international midstream and downstream markets.",
          items: [
            {
              title: "Global Supply Chain",
              description:
                "Efficient distribution networks reaching all major global industrial hubs across 50+ countries.",
              link: null,
            },
            {
              title: "Strategic Trading",
              description:
                "Deep market expertise for competitive edge in international trade and supply structures.",
              link: null,
            },
            {
              title: "Risk Management",
              description:
                "Structured commercial risk management with full transparency at every transaction stage.",
              link: null,
            },
            {
              title: "Long-Term Partnerships",
              description:
                "Building durable relationships on operational transparency and consistent performance.",
              link: null,
            },
          ],
        },
        {
          id: "trading-products",
          type: "specList",
          title: "Products We Trade",
          intro: null,
          items: [
            { term: "Base Oils", detail: "Group I, Group II, Group III" },
            { term: "High-purity solvents for industrial processes", detail: null },
            { term: "Broad range of petrochemical products", detail: null },
            { term: "Refined fuel products and energy commodities", detail: null },
          ],
          link: { label: "Discuss a Trade Structure", href: CONTACT },
        },
        { id: "trading-cta", ...PARTNER_CTA },
      ],
    },
  },
  "bv.logistics": {
    slug: "logistics",
    title: "Logistics",
    seo: seo("Logistics | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "logistics-open",
          type: "split",
          eyebrow: "Logistics & Transportation",
          title: "Reliable Delivery Across Global Markets",
          body: "We provide integrated sea and road logistics capabilities with coordinated shipment control and timely product distribution. Our comprehensive logistics network spans 50+ countries, ensuring that our partners receive their products on time and in perfect condition.",
          image: "/media/services-showcase/logistics-desktop.webp",
          imageAlt:
            "Illustrative CGI render of a tanker at a port crane and a road tanker on a curved quay at dusk.",
          imageNote: CGI_NOTE,
        },
        {
          id: "logistics-transport",
          type: "specList",
          title: "Transportation & Supply",
          intro:
            "Our transport operations cover fast and safe delivery routes across Europe, the Middle East, Asia, and the Americas — leveraging established shipping lanes and trusted carrier partnerships.",
          items: [
            { term: "Sea freight coordination", detail: "Bulk tankers, coaster vessels, parcels" },
            { term: "Road tanker logistics", detail: "ADR-compliant, across Europe" },
            { term: "Just-in-time delivery scheduling and tracking", detail: null },
            { term: "50+ countries served via established routing networks", detail: null },
          ],
          link: null,
        },
        {
          id: "logistics-storage",
          type: "cards",
          title: "Storage & Terminal Solutions",
          intro:
            "Our logistics network is fully integrated with high-capacity terminal storage at the Port of Rotterdam — enabling seamless transfer between sea, road, and rail modes.",
          items: [
            {
              title: "Bulk Liquid Storage",
              description:
                "High-capacity terminals for crude oil, refined fuels, and base oils. Advanced inventory monitoring, product segregation, and inline blending.",
              link: null,
            },
            {
              title: "Specialty Warehousing",
              description:
                "Temperature-controlled storage, hazardous material handling, drumming, IBC storage, and bonded warehousing.",
              link: null,
            },
            {
              title: "Last-Mile Distribution",
              description:
                "Dedicated road tanker fleets, regional hub delivery, and just-in-time supply capabilities across Europe.",
              link: null,
            },
            {
              title: "Quality Control",
              description:
                "On-site laboratories for continuous product specification testing. 24/7 surveillance and access control.",
              link: null,
            },
          ],
        },
        {
          id: "logistics-standards",
          type: "specList",
          title: "Operational Standards",
          intro: null,
          items: [
            { term: "International HSE protocols", detail: "Safety first approach" },
            { term: "ADR compliance for dangerous goods by road", detail: null },
            { term: "IMDG Code compliance for maritime transport", detail: null },
            { term: "Real-time digital inventory tracking and monitoring", detail: null },
            { term: "Advanced fire suppression and spill prevention systems", detail: null },
            {
              term: "Eco-compliance",
              detail: "Vapour recovery units, carbon footprint mitigation",
            },
          ],
          link: { label: "Request Logistics Quote", href: CONTACT },
        },
        { id: "logistics-cta", ...PARTNER_CTA },
      ],
    },
  },
  "bv.storage-distribution": {
    slug: "storage-distribution",
    title: "Storage & Distribution",
    seo: seo("Storage & Distribution | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "storage-open",
          type: "split",
          eyebrow: "Storage & Distribution",
          title: "Secure, High-Capacity Storage Solutions",
          body: "From the Port of Rotterdam — Europe's largest energy terminal hub — we manage bulk liquid storage, specialty warehousing, and comprehensive last-mile distribution across global markets.",
          image: "/media/services-showcase/storage-distribution-desktop.webp",
          imageAlt:
            "Illustrative CGI render of storage tanks, a road tanker loading bay and an amber-lit pipeline at night.",
          imageNote: CGI_NOTE,
        },
        {
          id: "storage-bulk",
          type: "specList",
          title: "Bulk Liquid Storage",
          intro:
            "Our high-capacity terminal storage facilities are equipped with advanced monitoring systems and meet the highest international standards for product integrity.",
          items: [
            {
              term: "High-capacity terminals for crude oil, refined fuels, and base oils",
              detail: null,
            },
            { term: "Advanced inventory monitoring with automated tank gauging", detail: null },
            { term: "Product segregation to maintain purity and specification", detail: null },
            { term: "Inline blending services for custom product formulations", detail: null },
          ],
          link: null,
        },
        {
          id: "storage-warehousing",
          type: "cards",
          title: "Specialty Warehousing",
          intro: null,
          items: [
            {
              title: "Temperature Control",
              description:
                "Controlled environments for temperature-sensitive petrochemical products.",
              link: null,
            },
            {
              title: "Hazmat Handling",
              description:
                "Certified dangerous goods handling — ADR and IMDG compliant facilities.",
              link: null,
            },
            {
              title: "Drumming & IBC",
              description: "Flexible packaging options: drums, IBCs, flexitanks, and repackaging.",
              link: null,
            },
            {
              title: "Bonded Warehousing",
              description: "Customs-bonded storage enabling tax-efficient inventory management.",
              link: null,
            },
          ],
        },
        {
          id: "storage-standards",
          type: "specList",
          title: "Operational Standards & Quality",
          intro: null,
          items: [
            {
              term: "On-site laboratories for continuous product specification testing",
              detail: null,
            },
            { term: "24/7 surveillance and gate access control at all terminals", detail: null },
            { term: "Advanced fire suppression and spill prevention systems", detail: null },
            { term: "Vapour recovery units and carbon footprint mitigation", detail: null },
            { term: "Real-time digital logistics monitoring and inventory accuracy", detail: null },
          ],
          link: { label: "Enquire About Storage Capacity", href: CONTACT },
        },
        { id: "storage-cta", ...PARTNER_CTA },
      ],
    },
  },
};
