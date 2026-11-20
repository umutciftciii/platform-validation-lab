/**
 * DP-250: one read of a CMS preview per request, shared by the preview's root layout (its
 * `<html lang>`) and its page (React `cache`: the same token is fetched once).
 */
import { cache } from "react";

import { getPreview } from "@/lib/cms-home";

export const previewRead = cache(getPreview);
