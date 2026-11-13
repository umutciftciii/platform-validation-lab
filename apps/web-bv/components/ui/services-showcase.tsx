"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { type ServiceItem, type ServicesCopy } from "@/content/services-showcase";

/** Mouse travel before a press counts as a drag rather than a click on a card. */
const DRAG_START_PX = 6;
/** A drag this long moves to the next card, even if the nearest one is still behind. */
const DRAG_FLICK_PX = 60;
const SETTLE_FALLBACK_MS = 700;

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Where each card rests. Cards the track cannot reach collapse onto its end. */
function restingPoints(track: HTMLElement) {
  const max = track.scrollWidth - track.clientWidth;
  const padding = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
  return Array.from(track.children, (card) =>
    Math.max(0, Math.min(max, (card as HTMLElement).offsetLeft - padding)),
  );
}

function ServiceCard({ service, isNear }: { service: ServiceItem; isNear: boolean }) {
  const { image } = service;
  const positions = {
    "--sv-position-desktop": image.desktop.position,
    "--sv-position-mobile": image.mobile.position,
  } as CSSProperties;

  return (
    <li className="sv-card" style={positions}>
      <picture>
        <source
          media="(max-width: 899px)"
          srcSet={image.mobile.src}
          width={image.mobile.width}
          height={image.mobile.height}
        />
        <img
          className="sv-image"
          src={image.desktop.src}
          width={image.desktop.width}
          height={image.desktop.height}
          alt={image.alt}
          loading={isNear ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
        />
      </picture>
      <div className="sv-card-text">
        <h3 className="sv-card-title">{service.title}</h3>
        <p className="sv-card-body sv-card-body-full">{service.description}</p>
        <p className="sv-card-body sv-card-body-short">{service.shortDescription}</p>
        {/* The link's ::after covers the card, so the whole card opens the page. */}
        <a
          href={service.cta.href}
          className="sv-card-link"
          aria-label={`${service.cta.label} about ${service.title}`}
          draggable={false}
        >
          {service.cta.label}
          <Arrow direction="right" size={16} />
        </a>
      </div>
    </li>
  );
}

function Arrow({ direction, size }: { direction: "left" | "right"; size: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M3 10h14M11.5 4.5 17 10l-5.5 5.5" />
    </svg>
  );
}

/** CMS S2: services and copy come from the published `bv.home` page (lib/cms-home.ts). */
export default function ServicesShowcase({
  services: SERVICES,
  copy: COPY,
}: {
  services: ServiceItem[];
  copy: ServicesCopy;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    active: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const settleTimerRef = useRef(0);

  const [canPrevious, setCanPrevious] = useState(false);
  const [canNext, setCanNext] = useState(true);
  const [isNear, setIsNear] = useState(false);

  // Lazy loading only looks at the track's own viewport, so a card off to the side
  // would load during the swipe that reveals it. Load all three as the section nears.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsNear(true);
        near.disconnect();
      },
      { rootMargin: "100% 0px" },
    );
    near.observe(section);
    return () => near.disconnect();
  }, []);

  // Arrows follow the real scroll position, however the track was moved.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = track.scrollWidth - track.clientWidth;
      setCanPrevious(track.scrollLeft > 2);
      setCanNext(track.scrollLeft < max - 2);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    track.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimerRef.current);
      track.removeEventListener("scroll", schedule);
      resize.disconnect();
    };
  }, []);

  const scrollToCard = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: restingPoints(track)[index], behavior: scrollBehavior() });
  };

  const step = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const left = track.scrollLeft;
    const points = restingPoints(track);
    const target =
      direction === 1
        ? points.find((point) => point > left + 2)
        : points.findLast((point) => point < left - 2);
    if (target !== undefined) track.scrollTo({ left: target, behavior: scrollBehavior() });
  };

  // Mouse only: trackpads and touch screens already scroll the track natively.
  const onPointerDown = (event: PointerEvent<HTMLUListElement>) => {
    suppressClickRef.current = false;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    window.clearTimeout(settleTimerRef.current);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: event.currentTarget.scrollLeft,
      active: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLUListElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (!drag.active) {
      if (Math.abs(distance) < DRAG_START_PX) return;
      drag.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      // Snapping would fight the pointer, so it stays off until the card has settled.
      event.currentTarget.dataset.dragging = "true";
    }
    event.currentTarget.scrollLeft = drag.startScroll - distance;
  };

  const endDrag = (event: PointerEvent<HTMLUListElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.active) return;

    const track = event.currentTarget;
    suppressClickRef.current = true;
    const distance = event.clientX - drag.startX;
    const left = track.scrollLeft;
    const points = restingPoints(track);
    const nearest = points.reduce((best, point) =>
      Math.abs(point - left) < Math.abs(best - left) ? point : best,
    );
    let target = nearest;
    if (distance <= -DRAG_FLICK_PX) {
      target = points.find((point) => point > drag.startScroll + 2) ?? nearest;
    } else if (distance >= DRAG_FLICK_PX) {
      target = points.findLast((point) => point < drag.startScroll - 2) ?? nearest;
    }

    const settle = () => {
      window.clearTimeout(settleTimerRef.current);
      track.removeEventListener("scrollend", settle);
      delete track.dataset.dragging;
    };
    track.addEventListener("scrollend", settle);
    settleTimerRef.current = window.setTimeout(settle, SETTLE_FALLBACK_MS);
    track.scrollTo({ left: target, behavior: scrollBehavior() });
  };

  // A drag that ends over a card must not open its link.
  const onClickCapture = (event: MouseEvent<HTMLUListElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // Part of the next card is on screen, so its link can take focus without moving
  // the track. Tabbing to a card always shows the whole card.
  const onFocus = (event: FocusEvent<HTMLUListElement>) => {
    if (!event.target.matches(":focus-visible")) return;
    const card = event.target.closest<HTMLElement>(".sv-card");
    const track = event.currentTarget;
    if (!card) return;
    const cardBox = card.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    if (cardBox.left >= trackBox.left && cardBox.right <= trackBox.right) return;
    scrollToCard(Array.prototype.indexOf.call(track.children, card));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const links = Array.from(
      event.currentTarget.querySelectorAll<HTMLAnchorElement>(".sv-card-link"),
    );
    const current = links.indexOf(event.target as HTMLAnchorElement);
    if (current === -1) return;
    const targets: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: links.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    links[next]?.focus();
  };

  return (
    <section ref={sectionRef} id="services" className="sv" aria-labelledby="services-title">
      {/* Without JavaScript the track still scrolls; only the arrows need a script. */}
      <noscript>
        <style>{".sv-controls { display: none; }"}</style>
      </noscript>

      <header className="sv-head">
        <p className="sv-eyebrow">{COPY.eyebrow}</p>
        <h2 id="services-title" className="sv-title">
          {COPY.title}
        </h2>
        <p className="sv-intro">{COPY.intro}</p>
      </header>

      <ul
        ref={trackRef}
        id="services-track"
        className="sv-track"
        aria-label={COPY.listLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        {SERVICES.map((service) => (
          <ServiceCard key={service.id} service={service} isNear={isNear} />
        ))}
      </ul>

      <div className="sv-foot">
        <p className="sv-disclosure">{COPY.disclosure}</p>
        <div className="sv-controls" role="group" aria-label={COPY.controlsLabel}>
          {/* aria-disabled, so focus is not lost when an arrow reaches the end. */}
          <button
            type="button"
            className="sv-arrow"
            aria-label={COPY.previous}
            aria-controls="services-track"
            aria-disabled={!canPrevious}
            onClick={() => step(-1)}
          >
            <Arrow direction="left" size={20} />
          </button>
          <button
            type="button"
            className="sv-arrow"
            aria-label={COPY.next}
            aria-controls="services-track"
            aria-disabled={!canNext}
            onClick={() => step(1)}
          >
            <Arrow direction="right" size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}
