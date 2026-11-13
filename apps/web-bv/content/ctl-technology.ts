/**
 * CTL Technology content. CMS integration is a later phase; these are the fields a
 * CMS entry would fill, so text, links and images change here only.
 *
 * Sources (read 2026-11-06):
 * - SITE: "From Synthesis Gas to ICCSYN Base Oils" on https://dreampetroleumbv.com/
 * - PDF: "ICCSYN CTL Base Oils - Technology Overview", slides 2, 4, 5 and 6. Its link
 *   is `document.href`; the live file and ~/Downloads/iccsyn-ctl-technology-overview.pdf
 *   are byte-identical.
 *
 * Do not add a performance figure here. The figures in the PDF and on the product
 * pages are typical values; binding values are on each lot's TDS or CoA.
 *
 * The images are representative. The first is not a verified CTL plant, the second is
 * not a reaction diagram, and the third is not a product sample. Each `disclosure`
 * says so next to its image and must stay with it. The oil itself is colourless: amber
 * in the third image is light on the glass.
 */

export type CtlImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** CSS object-position, for the wide frame from 900 px up. */
  positionDesktop: string;
  /** CSS object-position, for the narrower frame below that. */
  positionMobile: string;
};

export type CtlStage = {
  id: string;
  title: string;
  description: string;
  disclosure: string;
  image: CtlImage;
};

const MEDIA = "/media/ctl-technology";

export const CTL_COPY = {
  eyebrow: "CTL Technology",
  title: "From Synthesis Gas to ICCSYN Base Oils",
  stagesLabel: "Process stages",
  stageNavLabel: "Go to a process stage",
  skip: "Skip the CTL animation",
  document: {
    label: "CTL Technology Overview (PDF)",
    href: "https://dreampetroleumbv.com/assets/specs/iccsyn-ctl-technology-overview.pdf",
  },
} as const;

export const CTL_STAGES: CtlStage[] = [
  {
    id: "industrial-process",
    title: "Industrial Process",
    // SITE, word for word. Coal-to-Liquid and the coal, gas, wax order: PDF slides 4, 5.
    description:
      "Coal-to-Liquid (CTL) technology builds base oil molecules from synthesis gas through Fischer–Tropsch synthesis. The process converts coal into synthesis gas, then into paraffinic wax.",
    disclosure: "Representative industrial facility, not a verified CTL plant.",
    image: {
      src: `${MEDIA}/industrial-process.webp`,
      width: 826,
      height: 460,
      alt: "Representative image of an industrial processing facility lit at dusk.",
      positionDesktop: "45% 50%",
      positionMobile: "40% 50%",
    },
  },
  {
    id: "molecular-engineering",
    title: "Molecular Engineering",
    // PDF slide 6 for the linear paraffins, side branches and isoparaffins; slide 2 for
    // "isoparaffinic base stock".
    description:
      "Fischer–Tropsch synthesis produces long, linear paraffins (wax). Hydro-isomerisation adds short side branches, turning this wax into isoparaffinic base stock.",
    disclosure: "Abstract CGI of a molecule, not a reaction diagram.",
    image: {
      src: `${MEDIA}/molecular-visualization.webp`,
      width: 826,
      height: 460,
      alt: "Abstract CGI of glass spheres joined by rods, resembling a molecule, in amber light.",
      positionDesktop: "45% 50%",
      positionMobile: "45% 50%",
    },
  },
  {
    id: "clear-base-oil",
    title: "Clear Base Oil",
    // First sentence: PDF slide 2. Second: SITE, word for word.
    description:
      "The result is a water-white, almost pure isoparaffinic base stock. Hebei Feitian produces ICCSYN at its Xinji refinery; Dream Petroleum B.V. supplies European lubricant blenders.",
    disclosure:
      "Illustrative image, not a product sample. The oil is colourless; the amber is only reflected light.",
    image: {
      src: `${MEDIA}/clear-base-oil.webp`,
      width: 826,
      height: 461,
      alt: "Illustrative image of a clear, colourless liquid poured into a laboratory beaker, with amber light reflected on the glass.",
      positionDesktop: "50% 50%",
      positionMobile: "50% 50%",
    },
  },
];
