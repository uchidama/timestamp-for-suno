import type { ClipId } from '../shared/types.js';

/**
 * Exact UUID v1-v5 / standard 8-4-4-4-12 hex pattern.
 */
const EXACT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Matches `/song/<uuid>` or `/clip/<uuid>` in a URL or href path.
 * Explicitly avoids `/playlist/<uuid>` or `/workspace/<uuid>`.
 */
const SONG_PATH_UUID_REGEX =
  /(?:^|\/)(?:song|clip)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/**
 * Matches Suno media CDN URLs containing a clip UUID, e.g.:
 * - `.../image_<uuid>.jpeg`
 * - `.../image_large_<uuid>.jpeg`
 * - `.../<uuid>.mp3`
 */
const MEDIA_URL_UUID_REGEX =
  /(?:image_(?:large_)?|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpe?g|png|webp|mp3|mp4|wav|m4a)(?:[?#]|$)/i;

/**
 * Validates and normalizes a candidate Clip ID to lowercase UUID format.
 * Returns `null` if the value is not a valid UUID.
 */
export function normalizeClipId(value: unknown): ClipId | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!EXACT_UUID_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * Extracts a Clip ID from a URL or `href` attribute if it points to `/song/<uuid>` or `/clip/<uuid>`.
 */
export function extractClipIdFromUrl(urlOrHref: string | null | undefined): ClipId | null {
  if (!urlOrHref || typeof urlOrHref !== 'string') {
    return null;
  }
  const match = SONG_PATH_UUID_REGEX.exec(urlOrHref.trim());
  if (!match || !match[1]) {
    return null;
  }
  return match[1].toLowerCase();
}

/**
 * Extracts a Clip ID from a media (cover image / audio) URL when verified against known clip IDs
 * or matching Suno's `image_<uuid>` / `<uuid>.mp3` asset naming convention.
 */
export function extractClipIdFromMediaUrl(
  src: string | null | undefined,
  knownClipIds?: ReadonlySet<ClipId>,
): ClipId | null {
  if (!src || typeof src !== 'string') {
    return null;
  }
  const match = MEDIA_URL_UUID_REGEX.exec(src.trim());
  if (!match || !match[1]) {
    return null;
  }
  const candidate = match[1].toLowerCase();
  if (knownClipIds && knownClipIds.size > 0 && !knownClipIds.has(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * Extracts a Clip ID from the current browser `location` (e.g. `/song/<uuid>`).
 */
export function extractClipIdFromLocation(
  pathname: string,
  search = '',
): ClipId | null {
  const fromPath = extractClipIdFromUrl(pathname);
  if (fromPath) {
    return fromPath;
  }
  if (search) {
    try {
      const params = new URLSearchParams(search);
      const paramClip =
        params.get('clip') ?? params.get('clipId') ?? params.get('songId');
      const normalized = normalizeClipId(paramClip);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Ignore malformed query string
    }
  }
  return null;
}

/**
 * Checks explicit data attributes on a single DOM element (non-recursive).
 */
export function extractClipIdFromAttributes(element: Element): ClipId | null {
  const attrNames = [
    'data-clip-id',
    'data-song-id',
    'data-track-id',
    'data-id',
    'data-key',
  ];
  for (const attr of attrNames) {
    const val = element.getAttribute(attr);
    const normalized = normalizeClipId(val);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

/**
 * Extracts all distinct `/song/<uuid>` Clip IDs found within `root` (including `root` itself).
 */
export function findSongLinkClipIdsInSubtree(root: Element): ClipId[] {
  const ids = new Set<ClipId>();

  if (root.tagName.toLowerCase() === 'a') {
    const directId = extractClipIdFromUrl(root.getAttribute('href'));
    if (directId) {
      ids.add(directId);
    }
  }

  const anchors = root.querySelectorAll('a[href*="/song/"], a[href*="/clip/"]');
  for (let i = 0; i < anchors.length; i++) {
    const clipId = extractClipIdFromUrl(anchors[i].getAttribute('href'));
    if (clipId) {
      ids.add(clipId);
    }
  }

  return Array.from(ids);
}

/**
 * Extracts a Clip ID from a candidate song row or detail panel DOM element.
 *
 * Safety rules:
 * - Never matches by title text.
 * - If the subtree contains multiple distinct song rows, returns `null` so list containers
 *   are never mistaken for an individual song row.
 */
export function extractClipIdFromElement(
  element: Element,
  knownClipIds?: ReadonlySet<ClipId>,
): ClipId | null {
  // 1. Direct data-* attribute on the element itself
  const directAttrId = extractClipIdFromAttributes(element);
  if (directAttrId) {
    return directAttrId;
  }

  // 2. Descendant with explicit data-clip-id / data-song-id / data-track-id
  const explicitDataNodes = element.querySelectorAll(
    '[data-clip-id], [data-song-id], [data-track-id]',
  );
  if (explicitDataNodes.length > 0) {
    const dataIds = new Set<ClipId>();
    for (let i = 0; i < explicitDataNodes.length; i++) {
      const id = extractClipIdFromAttributes(explicitDataNodes[i]);
      if (id) {
        dataIds.add(id);
      }
    }
    if (dataIds.size === 1) {
      return Array.from(dataIds)[0];
    }
    if (dataIds.size > 1) {
      // Element wraps multiple distinct clips
      return null;
    }
  }

  // 3. Anchor links `/song/<uuid>` inside the element
  const linkIds = findSongLinkClipIdsInSubtree(element);
  if (linkIds.length === 1) {
    return linkIds[0];
  }
  if (linkIds.length > 1) {
    // Check if this is a detail panel or row where the primary title link is first
    // and a secondary link is a "remix/cover of" reference, vs a list of multiple rows.
    // If multiple links share the same structural row tag, it's a list container -> return null.
    return null;
  }

  // 4. Ancestor anchor if the element itself is inside `<a href="/song/<uuid>">`
  const closestAnchor = element.closest('a[href*="/song/"], a[href*="/clip/"]');
  if (closestAnchor) {
    const anchorClipId = extractClipIdFromUrl(closestAnchor.getAttribute('href'));
    if (anchorClipId) {
      return anchorClipId;
    }
  }

  // 5. Fallback: media asset URL (`image_<uuid>.jpeg` / `<uuid>.mp3`) ONLY if unambiguously single
  // and verified against `knownClipIds` when provided.
  const mediaElements = element.querySelectorAll('img[src], audio[src], source[src]');
  const mediaIds = new Set<ClipId>();
  for (let i = 0; i < mediaElements.length; i++) {
    const src = mediaElements[i].getAttribute('src');
    const id = extractClipIdFromMediaUrl(src, knownClipIds);
    if (id) {
      mediaIds.add(id);
    }
  }
  if (mediaIds.size === 1) {
    return Array.from(mediaIds)[0];
  }

  return null;
}
