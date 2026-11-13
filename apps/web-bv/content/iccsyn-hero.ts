/**
 * Static copy for the ICCSYN hero prototype. CMS integration is a later phase;
 * this file is the shape the CMS will eventually need to fill.
 *
 * Every application below comes from slide 11 ("Applications") of
 * "ICCSYN CTL Base Oils - Technology Overview" (Dream Petroleum B.V.).
 * Do not add an application or a claim here without a source document.
 *
 * Three card images were supplied for this hero (see each `source`). The others are
 * temporary frames from the project's own film tests. No card image shows a real
 * plant, customer equipment or product sample.
 */

export type IccsynApplication = {
  title: string;
  description: string;
  image: {
    src: string;
    /** True while the image is a film-test frame awaiting replacement. */
    temporary: boolean;
    /** How literally the frame shows this application. Review note, not displayed. */
    fit: "direct" | "close" | "abstract" | "weak";
    source: string;
  };
};

export const ICCSYN_HERO_COPY = {
  brand: "ICCSYN BASE OILS",
  tagline: "Purity in Motion.",
  scrollCue: "Scroll to explore",
  cta: "Explore ICCSYN Products",
  // Disabled for the review: this prototype has no product page. On the production
  // site, set this to the product route (the storyboard names /iccsyn-base-oils).
  ctaHref: null as string | null,
  ctaDisabledNote: "The product page is not connected in this demo.",
  supply: "Supplied in Europe by Dream Petroleum B.V.",
  legal:
    "ICCSYN® is a registered trademark of its respective owner. Temporary images and footage, not a product sample.",
  mediaAlt:
    "A nearly colourless base oil pouring into a glass laboratory beaker, with amber light reflecting off the glass.",
} as const;

export const ICCSYN_APPLICATIONS: IccsynApplication[] = [
  {
    title: "Passenger & heavy-duty engine oils",
    image: {
      src: "/media/iccsyn-cards/engine-valvetrain.webp",
      temporary: false,
      fit: "direct",
      source: "Hero Kart Görseli 1: engine camshaft and valve springs.",
    },
    description: "A base stock for low-viscosity 0W and 5W grades.",
  },
  {
    title: "Transmission & gear oils",
    image: {
      src: "/media/iccsyn-cards/temp/transmission-gear.webp",
      temporary: true,
      fit: "direct",
      source: "V3 SH05, frame 48: gearbox with helical gears.",
    },
    description: "Used for ATF, axle and industrial gear oils.",
  },
  {
    title: "Hydraulic fluids",
    image: {
      src: "/media/iccsyn-cards/hydraulic-power-unit.webp",
      temporary: false,
      fit: "direct",
      source: "Hero Kart Görseli 2: hydraulic cylinders, valve block and hoses.",
    },
    description: "For high-VI fluids in wide-temperature systems.",
  },
  {
    title: "Compressor & turbine oils",
    image: {
      src: "/media/iccsyn-cards/turbine-compressor-rotor.webp",
      temporary: false,
      fit: "direct",
      source: "Hero Kart Görseli 3: turbine and compressor blade stages.",
    },
    description: "For oils built around long life and low deposits.",
  },
  {
    title: "Industrial lubricants & greases",
    image: {
      src: "/media/iccsyn-cards/temp/industrial.webp",
      temporary: true,
      fit: "close",
      source: "V1 SH05, frame 120: helical gear in an industrial housing.",
    },
    description: "For premium synthetic blends.",
  },
  {
    title: "Specialty fluids",
    image: {
      src: "/media/iccsyn-cards/temp/specialty.webp",
      temporary: true,
      fit: "abstract",
      source: "V3 SH07, frame 60: clear droplet on a still surface.",
    },
    // The source footnote requires this testing caveat. Keep it with the claim.
    description:
      "Such as dielectric and immersion-cooling fluids; grade suitability must be confirmed by testing.",
  },
];
