/**
 * COM-7: a registered picture of the corporate site (lib/section-view.ts `corporateImage`) with its
 * stored size, so the page never shifts; nothing for an unknown or another site's file.
 */
import { corporateImage } from "@/lib/section-view";

/** A registered corporate picture with its stored size, or nothing. */
export function Picture({
  src,
  alt,
  className,
  sizes,
  eager = false,
}: {
  src: string | null | undefined;
  alt: string | null | undefined;
  className: string;
  sizes?: string;
  eager?: boolean;
}) {
  const image = corporateImage(src);
  if (!image) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- registered file, stored size
    <img
      src={image.src}
      width={image.width}
      height={image.height}
      alt={alt ?? ""}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      className={className}
    />
  );
}
