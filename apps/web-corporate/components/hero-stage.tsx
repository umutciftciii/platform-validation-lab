"use client";

/**
 * COM-7: the home page's opening — a full-width picture with the site's heading, and the activity
 * areas of `corporate.home` (`hero.slides`) as tabs along its foot. Choosing an area changes the
 * picture, the heading, the text and the button; nothing changes by itself (no autoplay).
 *
 *  - ARIA tabs: one tab stop; arrow keys, Home and End move between the areas (and select them).
 *  - Without JavaScript the first area is shown, every tab is still a visible label.
 *  - The pictures are registered corporate files (representative scenes, their alt texts say so);
 *    the first loads eagerly, the others lazily. A short cross-fade, none with reduced motion.
 */
import { useId, useRef, useState, type KeyboardEvent } from "react";

export interface StageSlide {
  label: string;
  title: string;
  intro: string;
  image: { src: string; width: number; height: number };
  imageAlt: string | null;
  cta: { label: string; href: string } | null;
}

export function HeroStage({
  eyebrow,
  title,
  intro,
  primary,
  slides,
  labels,
}: {
  eyebrow: string | null;
  /** The page's main heading (the site's line, e.g. "Global Energy Markets"). */
  title: string;
  /** The company sentence, beside the areas on wide screens. */
  intro: string;
  primary: { label: string; href: string };
  slides: StageSlide[];
  labels: { areas: string; areaOf: string };
}) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const slide = slides[active] ?? slides[0];
  if (!slide) return null;

  const select = (i: number, focus: boolean) => {
    const next = (i + slides.length) % slides.length;
    setActive(next);
    if (focus) tabs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const moves: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowDown: i + 1,
      ArrowLeft: i - 1,
      ArrowUp: i - 1,
      Home: 0,
      End: slides.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(to, true);
  };
  const count = (n: number) =>
    labels.areaOf.replace("{n}", String(n)).replace("{total}", String(slides.length));

  return (
    <section className="stage on-dark" aria-labelledby={`${base}-title`}>
      <div className="stage-media">
        {slides.map((s, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- registered file, stored size
          <img
            key={s.image.src + i}
            src={s.image.src}
            width={s.image.width}
            height={s.image.height}
            alt={i === active ? (s.imageAlt ?? "") : ""}
            aria-hidden={i === active ? undefined : true}
            data-active={i === active}
            loading={i === 0 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "auto"}
            decoding="async"
            className="stage-image"
          />
        ))}
        <span aria-hidden className="stage-shade" />
      </div>

      <div className="container-site stage-inner">
        <div className="stage-copy">
          <h1 id={`${base}-title`} className="stage-site-title">
            {eyebrow ? <span className="stage-brand">{eyebrow}</span> : null}
            <span>{title}</span>
          </h1>
          <div
            role="tabpanel"
            id={`${base}-panel`}
            aria-labelledby={`${base}-tab-${active}`}
            className="stage-panel"
            key={active}
          >
            <p className="stage-title">{slide.title}</p>
            <p className="stage-intro">{slide.intro}</p>
            <div className="stage-actions">
              {slide.cta ? (
                <a className="btn btn-accent btn-arrow" href={slide.cta.href}>
                  {slide.cta.label}
                </a>
              ) : null}
              <a className="btn btn-ghost" href={primary.href}>
                {primary.label}
              </a>
            </div>
          </div>
        </div>
        <aside className="stage-card" aria-label={labels.areas}>
          <p className="stage-card-count">{count(active + 1)}</p>
          <p className="stage-card-label">{slide.label}</p>
          <p className="stage-card-text">{intro}</p>
        </aside>
      </div>

      <div className="stage-foot">
        <div className="container-site">
          <div role="tablist" aria-label={labels.areas} className="stage-tabs">
            {slides.map((s, i) => (
              <button
                key={s.label + i}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${i}`}
                aria-selected={i === active}
                aria-controls={`${base}-panel`}
                tabIndex={i === active ? 0 : -1}
                className="stage-tab"
                onClick={() => select(i, false)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="stage-tab-num" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="stage-tab-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
