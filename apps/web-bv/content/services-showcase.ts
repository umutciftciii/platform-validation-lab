/**
 * Services Showcase content. CMS integration is a later phase; these are the fields
 * a CMS entry would fill, so a service's text, link or image changes here only.
 *
 * Source: the "Our Services" section of https://dreampetroleumbv.com/ (read 2026-11-06).
 * `description` is the site's full text, word for word, and shows on desktop.
 * `shortDescription` only removes words from it, so it fits a phone card. It must not
 * add a claim or a number that the full text does not have.
 *
 * The images are representative CGI renders. Never describe them as Dream Petroleum
 * facilities, vessels or vehicles.
 */

export type ServiceImageCrop = {
  src: string;
  width: number;
  height: number;
  /** CSS object-position. Keeps the subject in frame as the card's shape changes. */
  position: string;
};

export type ServiceImage = {
  alt: string;
  /** Full 4:3 render, used from 900 px up. */
  desktop: ServiceImageCrop;
  /** 3:4 crop on the subject, used below 900 px. */
  mobile: ServiceImageCrop;
};

export type ServiceItem = {
  id: string;
  title: string;
  description: string;
  shortDescription: string;
  cta: { label: string; href: string };
  image: ServiceImage;
};

const SITE = "https://dreampetroleumbv.com/en";
const MEDIA = "/media/services-showcase";
const DESKTOP_SIZE = { width: 1448, height: 1086 };
const MOBILE_SIZE = { width: 815, height: 1086 };

export const SERVICES_COPY = {
  eyebrow: "Our Services",
  title: "Specialized Petrochemical Services",
  intro:
    "From global energy trading to last-mile distribution — we manage the full supply chain with precision and reliability.",
  disclosure:
    "Illustrative CGI images. They do not show Dream Petroleum facilities, vessels or vehicles.",
  listLabel: "Services",
  controlsLabel: "Scroll services",
  previous: "Previous services",
  next: "Next services",
} as const;

export const SERVICES: ServiceItem[] = [
  {
    id: "energy-trading-supply",
    title: "Energy Trading & Supply",
    description:
      "Deep market expertise providing a competitive edge in international energy and chemical markets. FOB and CIF structures, risk-managed commercial execution.",
    shortDescription:
      "Deep market expertise providing a competitive edge in international energy and chemical markets.",
    cta: { label: "Learn More", href: `${SITE}/energy-trading` },
    image: {
      alt: "Illustrative CGI render of a tanker and a storage terminal at night under a glowing world map.",
      desktop: { ...DESKTOP_SIZE, src: `${MEDIA}/energy-trading-supply-desktop.webp`, position: "100% 30%" },
      mobile: { ...MOBILE_SIZE, src: `${MEDIA}/energy-trading-supply-mobile.webp`, position: "50% 30%" },
    },
  },
  {
    id: "storage-distribution",
    title: "Storage & Distribution",
    description:
      "World-class terminal services and integrated distribution from Rotterdam — high-capacity bulk liquid storage, specialty warehousing, and last-mile delivery.",
    shortDescription:
      "World-class terminal services and integrated distribution from Rotterdam.",
    cta: { label: "Learn More", href: `${SITE}/storage-distribution` },
    image: {
      alt: "Illustrative CGI render of storage tanks, a road tanker loading bay and an amber-lit pipeline at night.",
      desktop: { ...DESKTOP_SIZE, src: `${MEDIA}/storage-distribution-desktop.webp`, position: "100% 30%" },
      mobile: { ...MOBILE_SIZE, src: `${MEDIA}/storage-distribution-mobile.webp`, position: "50% 30%" },
    },
  },
  {
    id: "logistics",
    title: "Logistics",
    description:
      "Integrated sea and road logistics capabilities with coordinated shipment control and timely product distribution to 50+ countries across all major markets.",
    shortDescription:
      "Integrated sea and road logistics capabilities with coordinated shipment control and timely product distribution.",
    cta: { label: "Learn More", href: `${SITE}/logistics` },
    image: {
      alt: "Illustrative CGI render of a tanker at a port crane and a road tanker on a curved quay at dusk.",
      desktop: { ...DESKTOP_SIZE, src: `${MEDIA}/logistics-desktop.webp`, position: "100% 30%" },
      mobile: { ...MOBILE_SIZE, src: `${MEDIA}/logistics-mobile.webp`, position: "50% 30%" },
    },
  },
];
