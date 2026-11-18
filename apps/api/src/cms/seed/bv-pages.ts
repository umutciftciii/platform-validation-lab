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
import type { CmsArticleContent, CmsSeoInput } from "@dream/contracts";

const CONTACT = "/contact";
const TAGLINE =
  "Connecting global energy and chemical markets with excellence — from the heart of Rotterdam.";
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
  seo: CmsSeoInput;
  content: { sections: ({ id: string; type: string } & Record<string, unknown>)[] };
}

const seo = (title: string): CmsSeoInput => ({ title, description: null, noindex: false });

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
  // DP-206: the company pages and the blog post of the live site, read on 2026-11-18. Word for word;
  // the leftover "Welcome to Dream Chemicals" kicker is not used, the page name is the eyebrow.
  "bv.strategic-partnership": {
    slug: "strategic-partnership",
    title: "Strategic Partnership",
    seo: seo("Strategic Partnership | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "partnership-hero",
          type: "hero",
          eyebrow: "Synergy & Growth",
          title: "Strategic Partnership",
          intro: TAGLINE,
          cta: null,
        },
        {
          id: "partnership-intro",
          type: "text",
          title: "Driving Innovation Through Global Alliances",
          body: "We believe in the power of strategic alliances to unlock new markets, enhance supply chain resilience, and deliver superior value. Dream Petroleum actively seeks partners who share our vision for a sustainable and efficient industrial future.\n\nOur collaborative approach combines local market expertise with global technical capabilities to create unparalleled competitive advantages for all stakeholders.",
        },
        {
          id: "partnership-focus",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Global Collaboration",
              description:
                "Connecting with industry leaders across continents to expand our collective reach and market access.",
              link: null,
            },
            {
              title: "Sustainable Growth",
              description:
                "Focused on long-term value creation and environmental responsibility for all involved parties.",
              link: null,
            },
          ],
        },
        {
          id: "partnership-foundations",
          type: "cards",
          title: "Foundations of Successful Partnerships",
          intro: null,
          items: [
            {
              title: "Integrity",
              description:
                "Maintaining the highest ethical standards and transparency in every partnership agreement and commercial transaction.",
              link: null,
            },
            {
              title: "Value Creation",
              description:
                "Focused on delivering tangible economic and operational benefits for all involved parties across the supply chain.",
              link: null,
            },
            {
              title: "Innovation",
              description:
                "Leveraging collective expertise to drive technological progress, process efficiency, and market-leading solutions.",
              link: null,
            },
            {
              title: "Global Reach",
              description:
                "Ensuring long-term environmental viability and access to diverse international markets across 50+ countries.",
              link: null,
            },
          ],
        },
        {
          id: "partnership-methodology",
          type: "specList",
          title: "Partnership Methodology",
          intro:
            "Our engagement model is designed to be flexible yet structured, ensuring that every alliance is optimised for mutual growth and operational excellence.",
          items: [
            {
              term: "Joint Ventures & Strategic Alliances",
              detail:
                "Collaborative capital investment and resource sharing for large-scale projects.",
            },
            {
              term: "Technology Licensing & Transfer",
              detail:
                "Access to proprietary chemical processes and industrial intellectual property.",
            },
            {
              term: "Supply Chain Integration",
              detail: "Seamless logistics and distribution networking for global commodity flow.",
            },
            {
              term: "Market Entry Support",
              detail:
                "Leveraging our local footprint to facilitate swift and compliant market penetration.",
            },
          ],
          link: { label: "Become a Partner", href: CONTACT },
        },
        { id: "partnership-cta", ...PARTNER_CTA },
      ],
    },
  },
  "bv.sustainability": {
    slug: "sustainability",
    title: "Sustainability",
    seo: seo("Sustainability | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "sustainability-hero",
          type: "hero",
          eyebrow: "Commitment to the Future",
          title: "Sustainability",
          intro: TAGLINE,
          cta: null,
        },
        {
          id: "sustainability-intro",
          type: "text",
          title: "Driving Sustainable Innovation in Petrochemicals",
          body: "We believe that the future of the petrochemical industry lies at the intersection of operational excellence and environmental responsibility. Dream Petroleum is dedicated to minimising our environmental footprint while maximising social and economic value.\n\nOur ESG framework guides every decision — from supply chain optimisation to community investment — ensuring a resilient and sustainable future for all stakeholders.",
        },
        {
          id: "sustainability-focus",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Eco-Efficiency",
              description:
                "Reducing emissions and waste through advanced chemical processing and green logistics technologies.",
              link: null,
            },
            {
              title: "Social Responsibility",
              description:
                "Upholding the highest standards of safety, ethical conduct, and community engagement across all operations.",
              link: null,
            },
          ],
        },
        {
          id: "sustainability-pillars",
          type: "cards",
          title: "Our ESG Core Pillars",
          intro: null,
          items: [
            {
              title: "Environmental",
              description:
                "Transitioning to circular economy models and carbon reduction strategies across all operations and supply chains.",
              link: null,
            },
            {
              title: "Safety First",
              description:
                "Maintaining zero-harm workplaces through rigorous health and safety protocols for our global team.",
              link: null,
            },
            {
              title: "Community",
              description:
                "Investing in local development and fostering inclusive growth in the regions where we operate.",
              link: null,
            },
            {
              title: "Governance",
              description:
                "Ensuring absolute transparency, board accountability, and ethical business standards across all entities.",
              link: null,
            },
          ],
        },
        {
          id: "sustainability-logistics",
          type: "specList",
          title: "Green Logistics & Supply Chain",
          intro:
            "We are reimagining the petrochemical supply chain by integrating data-driven efficiency and low-carbon logistics solutions.",
          items: [
            {
              term: "Dynamic Route Optimisation to reduce fuel consumption and emissions",
              detail: null,
            },
            { term: "Intermodal Transport Solutions for lower carbon intensity", detail: null },
            { term: "Smart Storage Systems with zero-leakage technology", detail: null },
            { term: "Vapour recovery units across all terminal operations", detail: null },
            {
              term: "Carbon Neutral Goal",
              detail: "Committed to Net Zero emissions across Scope 1 and 2 by 2050",
            },
          ],
          link: { label: "Join Our Mission", href: CONTACT },
        },
        { id: "sustainability-cta", ...PARTNER_CTA },
      ],
    },
  },
  "bv.our-team": {
    slug: "our-team",
    title: "Our Leadership Team",
    seo: seo("Our Leadership Team | Dream Petroleum BV"),
    content: {
      sections: [
        {
          id: "team-hero",
          type: "hero",
          eyebrow: "Core Leadership & Teams",
          title: "Our Leadership Team",
          intro: TAGLINE,
          cta: null,
        },
        {
          id: "team-intro",
          type: "split",
          eyebrow: null,
          title: "Meet Our Dedicated Professionals",
          body: "Our leadership team brings decades of combined expertise across energy trading, logistics, terminal operations, and international market development. Each department is staffed with specialists committed to delivering exceptional results for our partners.",
          image: "/media/company/team-1.jpg",
          imageAlt:
            "A trading floor with screens of market charts and a world map, and a team working at desks.",
          imageNote: "Illustrative image.",
        },
        {
          id: "team-leadership",
          type: "specList",
          title: "Leadership Team",
          intro: null,
          items: [
            { term: "Executive Director", detail: "Chief Executive Officer · Trading Team" },
            { term: "Operations Director", detail: "Head of Operations · Operations Team" },
            { term: "Logistics Manager", detail: "Head of Logistics · Logistics Team" },
            { term: "Technical Director", detail: "Head of Technical · Technical Team" },
          ],
          link: { label: "Get In Touch With Our Team", href: CONTACT },
        },
        { id: "team-cta", ...PARTNER_CTA },
      ],
    },
  },
};

export interface CmsArticleSeed {
  slug: string;
  title: string;
  seo: CmsSeoInput;
  content: CmsArticleContent;
}

/**
 * DP-206: the live blog's only post, imported as a news article (DP-020). The live article has no
 * body beyond its summary; its category, date and reading time are not fields of an article here
 * (DP-152), so they are kept as the article's details. The date the site shows is the first
 * publication here; the live post is from July 2026 (cover uploaded 2026-07-20).
 */
export const CMS_ARTICLE_SEEDS: Readonly<Record<string, CmsArticleSeed>> = {
  "bv.news-oil-prices-us-iran": {
    slug: "why-are-oil-prices-falling-the-impact-of-the-us-iran-agreement-on-energy-markets",
    title: "Why Are Oil Prices Falling? The Impact Of The US-Iran Agreement On Energy Markets",
    seo: {
      title: "Why Are Oil Prices Falling? | Dream Petroleum BV",
      description: null,
      noindex: false,
    },
    content: {
      excerpt:
        "An in-depth analysis of how the recent geopolitical developments between the US and Iran are reshaping global energy price dynamics and what it means for petrochemical traders.",
      coverImage: "/media/news/why-are-oil-prices-falling.jpg",
      coverAlt:
        "A crude oil tanker sailing through a strait between mountains, with a glowing map outline of the coastline over the water.",
      sections: [
        {
          id: "article-details",
          type: "specList",
          title: "Article details",
          intro: null,
          items: [
            { term: "Category", detail: "Market Analysis" },
            { term: "Originally published", detail: "July 2026" },
            { term: "Reading time", detail: "5 min read" },
          ],
          link: null,
        },
      ],
    },
  },
};
