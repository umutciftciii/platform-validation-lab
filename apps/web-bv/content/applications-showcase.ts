/**
 * Applications content. CMS integration is a later phase; these are the fields a CMS
 * entry would fill, so text, links and images change here only.
 *
 * Source: media-source/applications/README.txt. All three images are AI-generated
 * concept visuals, not photographs of real products or plants.
 *
 * Do not state or imply that ICCSYN is used in plastics, pacifiers, food-contact
 * materials, packaging, cosmetics or medical products. Do not add a suitability, safety
 * or certification claim. Group III base oils are lubricant base stocks, not by default
 * raw materials for polymer resins. A claim here needs an exact product-grade TDS and
 * written manufacturer approval for the intended application, with regulatory
 * compliance checked where relevant. `status` and each `disclosure` must stay visible.
 */

export type ApplicationLink = { label: string; href: string };

export type ApplicationImage = {
  /** 1448 px wide: the full-bleed desktop scene. */
  src: string;
  /** 828 px wide: what phones download. */
  srcSmall: string;
  width: number;
  height: number;
  alt: string;
  /** CSS object-position, for the wide frame from 900 px up. */
  positionDesktop: string;
};

export type ApplicationScene = {
  id: string;
  title: string;
  description: string;
  disclosure: string;
  cta: ApplicationLink;
  image: ApplicationImage;
};

const MEDIA = "/media/applications";
const SIZE = { width: 1448, height: 1086 };
const CONTACT = "https://dreampetroleumbv.com/en/contact";
const DISCLOSURE = "AI-generated concept image. Not a real product and not a verified ICCSYN application.";

export const APPLICATIONS_COPY = {
  eyebrow: "Applications",
  title: "Potential Application Concepts",
  status: "Pending Technical Validation",
  intro:
    "Three visual ideas for discussion. None of them is a confirmed use of ICCSYN.",
  skip: "Skip the application concepts animation",
  scenesLabel: "Application concepts",
  sceneNavLabel: "Go to an application concept",
  validation: {
    title: "What validation would require",
    intro: "No concept above becomes an application until each of these is in place.",
    requirements: [
      "An exact product-grade Technical Data Sheet (TDS)",
      "Written manufacturer approval for the intended application",
      "Regulatory compliance review, where relevant",
    ],
    note: "Group III base oils are lubricant base stocks, not by default raw materials for polymer resins.",
    cta: { label: "Contact Dream Petroleum", href: CONTACT },
  },
} as const;

export const APPLICATION_SCENES: ApplicationScene[] = [
  {
    id: "transparent-polymers",
    title: "Transparent Polymers",
    description:
      "A visual study of clear containers, film, tubing and moulded parts. It frames a question to explore, not an established use.",
    disclosure: DISCLOSURE,
    cta: { label: "Discuss this concept", href: CONTACT },
    image: {
      ...SIZE,
      src: `${MEDIA}/transparent-polymers-1448.webp`,
      srcSmall: `${MEDIA}/transparent-polymers-828.webp`,
      alt: "AI-generated concept image of clear plastic containers, a film roll, pouches, tubing and moulded parts on a dark reflective surface, with amber light.",
      positionDesktop: "50% 42%",
    },
  },
  {
    id: "baby-care-concept",
    title: "Baby Care Concepts",
    description:
      "A creative concept only. No suitability for baby products, medical use or food contact is stated or implied.",
    disclosure: DISCLOSURE,
    cta: { label: "See what validation requires", href: "#applications-validation" },
    image: {
      ...SIZE,
      src: `${MEDIA}/baby-care-concept-1448.webp`,
      srcSmall: `${MEDIA}/baby-care-concept-828.webp`,
      alt: "AI-generated concept image of a clear baby bottle, cup, pacifier and teething ring on a dark reflective surface, with amber light.",
      positionDesktop: "50% 30%",
    },
  },
  {
    id: "personal-care-packaging",
    title: "Personal Care Packaging",
    description:
      "A visual concept of clear bottles, pumps and jars. It is not evidence of use in packaging or cosmetic formulations.",
    disclosure: DISCLOSURE,
    cta: { label: "See how ICCSYN is made", href: "#ctl-technology" },
    image: {
      ...SIZE,
      src: `${MEDIA}/personal-care-packaging-1448.webp`,
      srcSmall: `${MEDIA}/personal-care-packaging-828.webp`,
      alt: "AI-generated concept image of clear pump bottles, a cream jar, caps and spray bottles on a dark reflective surface, with amber light.",
      positionDesktop: "50% 34%",
    },
  },
];
