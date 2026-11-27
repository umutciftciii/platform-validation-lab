// COM-5: generated once from the live dreampetroleum.com (crawl 2026-11-27) by the owner's
// content-import tool (see docs/cms/corporate-content/README.md). Every text is the live site's;
// edit here like any import seed.
/**
 * COM-5 (DP-038): the seven corporate content pages of the live site (about, the three services,
 * sustainability, strategic partnership, team) as "Import into CMS" seeds of the standard
 * template, in English (the site's default language). Left out: counters and figures, "world-class"
 * and "guarantee" statements, the mission's "production" wording, own-storage-asset claims (DP-003:
 * docs/cms/corporate-content/claims-review.csv) and every image (DP-326). Buttons go to /contact.
 */
import type { CmsPageSeed } from "./bv-pages.js";

export const CORPORATE_PAGE_SEEDS: Readonly<Record<string, CmsPageSeed>> = {
  "corporate.about-us": {
    slug: "about-us",
    title: "About Us",
    seo: {
      title: "About Us | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "about-us-s01",
          type: "text",
          title: "What we do",
          body: "Dream Petroleum connects global energy markets through reliable trading, strategic sourcing, and efficient supply solutions.\n\nOperating across key international markets, we facilitate the movement of essential petroleum products from trusted refineries to end users, ensuring continuity, flexibility, and performance at every stage of the supply chain.\n\nFrom base oils used in automotive and industrial applications to a wide range of petrochemical and fuel products, our portfolio supports critical operations across multiple industries. These products play a vital role in powering transportation, manufacturing, and infrastructure worldwide.\n\nThrough strong partnerships and an extensive global network, we manage sourcing, storage, and distribution with precision and speed. Our approach is built on adaptability — enabling us to respond to market dynamics while maintaining consistent quality and reliability.\n\nWith a particular focus on Africa, the Middle East, and Asia, Dream Petroleum continues to expand its reach, delivering energy solutions tailored to regional and international demands.\n\nAs a trusted trading partner, we do more than move products — we enable industries, support growth, and help keep the world in motion.",
        },
        {
          id: "about-us-s02",
          type: "text",
          title: "Our Vision",
          body: "Our vision is to be a leading supplier of premium base oils and speciality products in key end markets.",
        },
        {
          id: "about-us-s03",
          type: "text",
          title: "Global Network & Presence",
          body: "Our dynamic ecosystem stretches across continents. Explore our assets and strategic partnerships defining the future of energy.",
        },
        {
          id: "about-us-s04",
          type: "text",
          title: "Key Target Markets",
          body: "Dream Petroleum is strategically positioned to serve key energy markets across Africa, the Middle East, Asia, and the Americas, ensuring reliable supply, flexible logistics, and consistent product availability.\n\nAfrica: Africa represents a growing and dynamic market, where demand for petroleum products continues to increase across industrial, transportation, and infrastructure sectors. We actively support regional supply chains by delivering base oils, fuels, and petrochemical products, ensuring stable access to energy resources across key African markets.\n\nMiddle East:As one of the world’s leading energy hubs, the Middle East plays a central role in our sourcing and trading operations. Through strong relationships with regional refineries and suppliers, we secure high-quality products and facilitate efficient distribution both within the region and to global markets.\n\nAsia: Asia remains one of the fastest-growing energy markets globally, driven by expanding industrial activity and manufacturing demand. We supply a wide range of products to support automotive, industrial, and chemical sectors, while adapting to the region’s evolving energy needs.\n\nNorth & South America:The Americas represent a key component of our global trading network. From established markets in North America to emerging opportunities in South America, we engage in strategic sourcing and distribution, supporting both upstream and downstream operations across the region.\n\nGlobal Outlook:With a flexible and market-driven approach, Dream Petroleum continues to expand its footprint, connecting regional supply with global demand. Our ability to operate across multiple geographies allows us to respond quickly to market changes while maintaining reliability and efficiency.",
        },
      ],
    },
  },
  "corporate.logistics": {
    slug: "logistics",
    title: "Logistics",
    seo: {
      title: "Logistics | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "logistics-s01",
          type: "hero",
          eyebrow: null,
          title: "We Make Transport Fast And Safe",
          intro: "We are on the road to carry your dreams.",
          cta: null,
        },
        {
          id: "logistics-s02",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Safe Delivery",
              description:
                "We transport your products safely with our experienced staff and technology.",
              link: null,
            },
            {
              title: "Experienced Team",
              description:
                "We provide service with our experienced team as a result of long studies.",
              link: null,
            },
            {
              title: "Quality Service",
              description:
                "We work by focusing on the best in order to give you the best of all our services.",
              link: null,
            },
            {
              title: "Service & Technology",
              description:
                "We carry your products with the latest technologies at international quality standards.",
              link: null,
            },
          ],
        },
        {
          id: "logistics-s03",
          type: "text",
          title: "Fast Logistics",
          body: "With our company, which produces practical solutions to heavy problems, we are carrying out heavy loads. Our brand, which provides corporate services at affordable prices, is at your service to carry your dreams.",
        },
        {
          id: "logistics-s04",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Intercontinental Transport",
              description:
                "In intercontinental transportation, we do sea and air land transportation.",
              link: null,
            },
            {
              title: "Fast Loading",
              description: "We carry your heavy loads quickly and deliver them on time.",
              link: null,
            },
          ],
        },
        {
          id: "logistics-s05",
          type: "text",
          title: "We Make Limits Unlimited",
          body: "With our competent experience, we cross the borders in our logistics services and make deliveries safely. We are moving towards our goals by adopting fast and safe transportation as a principle.",
        },
      ],
    },
  },
  "corporate.energy-trading": {
    slug: "energy-trading",
    title: "Energy Trading & Supply",
    seo: {
      title: "Energy Trading & Supply | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "energy-trading-s01",
          type: "hero",
          eyebrow: null,
          title: "Energy Trading & Supply",
          intro:
            "Connecting global energy resources with strategic market demand through disciplined trading and reliable supply chain execution.",
          cta: null,
        },
        {
          id: "energy-trading-s02",
          type: "text",
          title: "Navigating Global Energy Flux",
          body: "Dream Petroleum operates at the intersection of supply and demand, leveraging deep market intelligence and a robust network to deliver transparent, reliable, and efficient energy solutions across the globe.",
        },
        {
          id: "energy-trading-s03",
          type: "cards",
          title: "Our Trading Capabilities",
          intro:
            "We specialize in the physical trade of energy commodities, ensuring seamless movement from production points to end-users.",
          items: [
            {
              title: "Crude Oil & Feedstocks",
              description:
                "Strategic sourcing and supply of various crude oil grades and refinery feedstocks to global processing hubs.\n\n• Regional Grade Optimization\n• Refinery Supply Security\n• Direct Producer Links",
              link: null,
            },
            {
              title: "Refined Products",
              description:
                "Trading and distribution of high-quality refined fuels and lubricants across international downstream markets.\n\n• Gasoline & Diesel (EN590)\n• Jet Fuel (A1)\n• Fuel Oils & Bitumen",
              link: null,
            },
            {
              title: "Petrochemical Products",
              description:
                "Bridging the gap in the petrochemical supply chain with reliable access to essential chemical building blocks.\n\n• Aromatics & Aliphatics\n• Polymer Resins\n• Solvent Feedstocks",
              link: null,
            },
          ],
        },
        {
          id: "energy-trading-s04",
          type: "cards",
          title: "Structured Risk Management",
          intro:
            "In the volatile energy markets, discipline is paramount. Dream Petroleum employs rigorous risk management frameworks to protect value and ensure operational continuity for our partners.",
          items: [
            {
              title: "Market Analysis",
              description: "Real-time monitoring of global energy trends and price drivers.",
              link: null,
            },
            {
              title: "Credit Control",
              description: "Stringent counterparty vetting and financial security protocols.",
              link: null,
            },
            {
              title: "Hedging Strategies",
              description: "Sophisticated financial tools to mitigate commodity price exposure.",
              link: null,
            },
            {
              title: "Compliance",
              description: "Adherence to international trade regulations and standards.",
              link: null,
            },
          ],
        },
        {
          id: "energy-trading-s05",
          type: "cards",
          title: "The Dream Advantage",
          intro: null,
          items: [
            {
              title: "Transparency",
              description: "Open communication and clear execution logs for every trade.",
              link: null,
            },
            {
              title: "Execution Speed",
              description: "Agile decision-making tailored to fast-moving market conditions.",
              link: null,
            },
            {
              title: "Reliability",
              description: "A track record of delivery even in challenging environments.",
              link: null,
            },
          ],
        },
        {
          id: "energy-trading-s06",
          type: "cards",
          title: "Integrated Supply Chain",
          intro: null,
          items: [
            {
              title: "Tanker Coordination",
              description:
                "Real-time tracking and management of seafaring assets for bulk energy transport.",
              link: null,
            },
            {
              title: "Storage & Terminaling",
              description:
                "Strategic access to storage hubs to balance market supply and demand fluctuations.",
              link: null,
            },
          ],
        },
        {
          id: "energy-trading-s07",
          type: "cta",
          title: "Ready to optimize your energy supply?",
          text: "Contact our trading desk today for a consultation on market structures and supply solutions.",
          button: {
            label: "Contact Our Desk",
            href: "/contact",
          },
        },
      ],
    },
  },
  "corporate.storage-distribution": {
    slug: "storage-distribution",
    title: "Storage & Distribution",
    seo: {
      title: "Storage & Distribution | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "storage-distribution-s01",
          type: "hero",
          eyebrow: null,
          title: "Storage & Distribution",
          intro: null,
          cta: null,
        },
        {
          id: "storage-distribution-s02",
          type: "cards",
          title: "Terminal & Warehousing Solutions",
          intro:
            "From bulk petroleum terminals to specialty chemical warehouses, we provide the infrastructure necessary for modern energy trading.",
          items: [
            {
              title: "Bulk Liquid Storage",
              description:
                "High-capacity terminal storage for crude oil, refined fuels, and base oils with advanced inventory monitoring.\n\n• Product Segregation\n• Inline Blending Services\n• Automated Tank Gauging",
              link: null,
            },
            {
              title: "Specialty Warehousing",
              description:
                "Temperature-controlled and safely managed facilities for drumming, IBC storage, and petrochemical products.\n\n• Hazardous Mat. Handling\n• Bonded Warehousing\n• Repackaging Facilities",
              link: null,
            },
            {
              title: "Last-Mile Distribution",
              description:
                "Fully integrated transport solutions moving product from storage facilities directly to end-user locations.\n\n• Road Tanker Fleet\n• Regional Hub Delivery\n• Just-In-Time Supply",
              link: null,
            },
          ],
        },
        {
          id: "storage-distribution-s03",
          type: "cards",
          title: "Safety, Security & Product Integrity",
          intro:
            "In midstream operations, the integrity of the product and the safety of the environment are our highest priorities. Our facilities operate under strict international HSE (Health, Safety, and Environment) protocols.",
          items: [
            {
              title: "Quality Control",
              description: "On-site laboratories for continuous product specification testing.",
              link: null,
            },
            {
              title: "HSE Management",
              description: "Advanced fire suppression and spill prevention systems.",
              link: null,
            },
            {
              title: "Security Systems",
              description: "24/7 surveillance and access control at all terminal gates.",
              link: null,
            },
            {
              title: "Eco-Compliance",
              description: "Vapor recovery units and carbon footprint mitigation tools.",
              link: null,
            },
            {
              title: "Real-Time Monitoring",
              description: "Every liter accounted for with digital inventory systems.",
              link: null,
            },
          ],
        },
        {
          id: "storage-distribution-s04",
          type: "text",
          title: "Efficient Flow, Global Impact",
          body: "Our distribution capabilities span continents, ensuring that industrial partners have access to the energy resources they need to thrive.",
        },
        {
          id: "storage-distribution-s05",
          type: "cta",
          title: "Discuss your storage requirements?",
          text: "Our operational team is ready to design a custom warehousing and distribution plan for your products.",
          button: {
            label: "Speak to Operations",
            href: "/contact",
          },
        },
      ],
    },
  },
  "corporate.sustainability": {
    slug: "sustainability",
    title: "Sustainability",
    seo: {
      title: "Sustainability | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "sustainability-s01",
          type: "hero",
          eyebrow: null,
          title: "Sustainability",
          intro:
            "Driving progress through responsible energy distribution and environmental stewardship.",
          cta: null,
        },
        {
          id: "sustainability-s02",
          type: "text",
          title: "Building a Sustainable Future",
          body: "At Dream Petroleum, we believe that the long-term success of the global energy market is intrinsically linked to how we protect our planet and empower our people.\n\nOur approach to sustainability is embedded in every vertical of our midstream and downstream operations. From optimizing logistics routes to reduce carbon emissions to upholding the highest safety standards in petroleum storage and distribution, we are committed to being a reliable partner for both our clients and the environment.",
        },
        {
          id: "sustainability-s03",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Eco-Efficiency",
              description: "Operational optimization",
              link: null,
            },
            {
              title: "Social Value",
              description: "Community empowerment",
              link: null,
            },
          ],
        },
        {
          id: "sustainability-s04",
          type: "cards",
          title: "Our Sustainability Framework",
          intro:
            "We focus our efforts where we can make the most significant impact, ensuring transparency and accountability across our international trade network.",
          items: [
            {
              title: "Environmental Stewardship",
              description:
                "Implementing carbon-conscious logistics and advanced waste management protocols at all storage facilities to minimize our ecological footprint.",
              link: null,
            },
            {
              title: "Health & Safety",
              description:
                "Maintaining a zero-accident culture through rigorous training, spill prevention technologies, and consistent audit processes across road and sea channels.",
              link: null,
            },
            {
              title: "Social Responsibility",
              description:
                "Fostering inclusive growth by partnering with local suppliers and ensuring ethical labor practices throughout our global supply chain.",
              link: null,
            },
            {
              title: "Ethical Governance",
              description:
                "Operate with absolute transparency and disciplined risk management, adhering to international compliance and anti-corruption standards.",
              link: null,
            },
          ],
        },
        {
          id: "sustainability-s05",
          type: "text",
          title: "Efficiency as a Sustainability Driver",
          body: "Logistics is the backbone of the energy trade. By leveraging modern ship coordination and route optimization, Dream Petroleum significantly reduces fuel consumption and operational emissions.\n\n• AI-driven route optimization for sea tankers\n• Modernized road fleet with lower emission ratings\n• Real-time monitoring of cargo integrity to prevent loss\n• Strategic storage locations minimizing transport distances",
        },
        {
          id: "sustainability-s06",
          type: "cta",
          title: "Join Our Journey Toward Sustainability",
          text: "Are you interested in our sustainability initiatives or looking for a partner that shares your ESG values? Let's discuss how we can work together.",
          button: {
            label: "Get in Touch",
            href: "/contact",
          },
        },
      ],
    },
  },
  "corporate.strategic-partnership": {
    slug: "strategic-partnership",
    title: "Strategic Partnership",
    seo: {
      title: "Strategic Partnership | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "strategic-partnership-s01",
          type: "hero",
          eyebrow: null,
          title: "Strategic Partnership",
          intro: "Our vision for strong collaborations and global growth.",
          cta: null,
        },
        {
          id: "strategic-partnership-s02",
          type: "text",
          title: "Building the Future through Partnerships",
          body: "At Dream Petroleum, we believe that sustainable success is built on the foundation of strong and transparent collaborations.\n\nAs a reliable partner in global energy markets, we create value together with our stakeholders and aim for mutual growth. Every partnership means a new vision and a wider network.",
        },
        {
          id: "strategic-partnership-s03",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Global Collaboration",
              description: "Optimizing energy supply with projects that transcend borders.",
              link: null,
            },
            {
              title: "Strategic Growth",
              description: "Entering new markets with confidence alongside our partners.",
              link: null,
            },
          ],
        },
        {
          id: "strategic-partnership-s04",
          type: "cards",
          title: "Our Partnership Principles",
          intro: "We move forward with a business model built on trust and transparency.",
          items: [
            {
              title: "Transparency",
              description: "We base all our processes on honesty and openness.",
              link: null,
            },
            {
              title: "Mutual Value",
              description: "We develop sustainable models that provide gains for both parties.",
              link: null,
            },
            {
              title: "Innovation",
              description:
                "We make a difference with technological integration and new business models.",
              link: null,
            },
            {
              title: "Global Power",
              description: "We offer logistics and supply advantages through a wide network.",
              link: null,
            },
          ],
        },
        {
          id: "strategic-partnership-s05",
          type: "text",
          title: "How We Work?",
          body: "We offer our business partners a wide range of strategic advantages:\n\n• Supply Chain Management\n• Market Expansion Strategies\n• Joint Investment Projects\n• Operational Consultancy",
        },
        {
          id: "strategic-partnership-s06",
          type: "cta",
          title: "Start a New Success Story",
          text: "We look forward to meeting leading organizations that share our vision.",
          button: {
            label: "Get in Touch",
            href: "/contact",
          },
        },
      ],
    },
  },
  "corporate.our-team": {
    slug: "our-team",
    title: "Our Team",
    seo: {
      title: "Our Team | Dream Petroleum",
      description: null,
      noindex: false,
    },
    content: {
      sections: [
        {
          id: "our-team-s01",
          type: "hero",
          eyebrow: null,
          title: "Our Leadership Team",
          intro:
            "Driving global energy solutions through decades of collective expertise and a commitment to excellence.",
          cta: null,
        },
        {
          id: "our-team-s02",
          type: "text",
          title: "Experts in Market Dynamics",
          body: "Our team consists of industry veterans, strategic traders, and operational specialists who bring a wealth of knowledge from across the global petroleum and energy sectors.",
        },
        {
          id: "our-team-s03",
          type: "cards",
          title: "The Minds Behind Our Success",
          intro: "Strategic direction and operational excellence led by experienced executives.",
          items: [
            {
              title: "Trade Team",
              description:
                "Experienced professionals conducting trade in crude oil, refined products, and natural gas in global energy markets.",
              link: null,
            },
            {
              title: "Operations Team",
              description:
                "Operations specialists who manage supply chain processes end-to-end, ensuring timely and secure delivery.",
              link: null,
            },
            {
              title: "Logistics Specialists",
              description:
                "Specialists who plan at international standards in sea, land, and pipeline transportation.",
              link: null,
            },
            {
              title: "Technical Consultants",
              description:
                "Consulting staff shaping the sector in energy infrastructure and regulatory compliance.",
              link: null,
            },
          ],
        },
        {
          id: "our-team-s04",
          type: "text",
          title: "Global Perspective",
          body: "Our team is distributed across major energy hubs, providing 24/7 market coverage and real-time response capabilities.",
        },
        {
          id: "our-team-s05",
          type: "cta",
          title: "Join Our Expert Network",
          text: "We are always looking for talented individuals who are passionate about the energy markets and global logistics.",
          button: {
            label: "View Careers",
            href: "/contact",
          },
        },
        {
          id: "our-team-s06",
          type: "cards",
          title: null,
          intro: null,
          items: [
            {
              title: "Integrity",
              description:
                "Honesty and transparency are at the core of every partnership we build.",
              link: null,
            },
            {
              title: "Innovation",
              description:
                "Constantly seeking smarter, more efficient ways to bridge supply and demand.",
              link: null,
            },
            {
              title: "Commitment",
              description:
                "Dedicated to the success and sustainability of the global energy sector.",
              link: null,
            },
          ],
        },
      ],
    },
  },
};

/** COM-5: the live contact page's texts (the COM-4 seed updated; the note stays the platform's). */
export const CORPORATE_CONTACT_CONTENT: CmsPageSeed["content"] = {
  sections: [
    {
      id: "contact-hero",
      type: "hero",
      eyebrow: null,
      title: "Contact Us",
      intro:
        "Have a question or need a consultation? Our team is here to provide the support and information you need.",
      cta: null,
    },
    {
      id: "contact-details",
      type: "contact",
      title: "We are always ready to help you and answer your questions",
      intro:
        "Whether you have a question, a suggestion, or just want to say hello, this is the place to do it. Please fill out the form below with your details and message, and we'll get back to you as soon as possible.",
      formTitle: "Get In Touch",
      formNote:
        "The contact form is not available yet. Please call us or write to us by e-mail in the meantime.",
    },
  ],
};

/** COM-5: the live news list heading and introduction (COM-3 seed updated). */
export const CORPORATE_NEWS_INDEX_LIVE = {
  title: "News & Insights",
  intro: "Industry updates, market commentary and operational news from the Dream Petroleum team.",
} as const;
