import {
  extractClipIdFromAttributes,
  extractClipIdFromElement,
  extractClipIdFromLocation,
  extractClipIdFromUrl,
  normalizeClipId,
} from './clip-id.js';
import type { TimestampProvider } from '../data/provider.js';
import { formatTimestamp } from '../shared/datetime.js';
import type { ClipId } from '../shared/types.js';

export const BADGE_ATTR = 'data-suno-timestamp-badge';
export const BADGE_CLIP_ID_ATTR = 'data-suno-timestamp-clip-id';
export const BADGE_UTC_ATTR = 'data-suno-timestamp-utc';
export const TARGET_BOUND_ATTR = 'data-suno-timestamp-target';
const STYLE_ELEMENT_ID = 'suno-timestamp-extension-styles';

export type BadgeTargetKind = 'row' | 'detail';

export interface TargetDescriptor {
  kind: BadgeTargetKind;
  /** The logical container representing a single song row or detail panel */
  container: Element;
  /** The specific element after/inside which the timestamp line should be rendered */
  mountPoint: Element;
  /** How to attach relative to `mountPoint` */
  mountPosition: 'append' | 'after';
  /** Verified Clip ID for this target */
  clipId: ClipId;
}

/**
 * Injects the lightweight stylesheet once into `document.head`.
 * Uses `color: inherit` + subtle opacity so it naturally adapts to both Suno Dark and Light themes.
 */
export function ensureStylesInjected(doc: Document = document): void {
  if (!doc.head || doc.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    [${BADGE_ATTR}] {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 11px;
      line-height: 1.35;
      margin-top: 2px;
      color: inherit;
      opacity: 0.68;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: text;
      pointer-events: auto;
      max-width: 100%;
    }
    [${BADGE_ATTR}="detail"] {
      font-size: 12px;
      margin-top: 4px;
      margin-bottom: 2px;
      opacity: 0.78;
    }
  `;
  doc.head.appendChild(style);
}

/**
 * Creates or updates a timestamp badge element using only safe `textContent` and attributes.
 * Never uses `innerHTML`.
 */
export function createOrUpdateBadgeElement(
  doc: Document,
  existingBadge: HTMLElement | null,
  kind: BadgeTargetKind,
  clipId: ClipId,
  utcIso: string,
  timeZoneOverride?: string,
): HTMLElement | null {
  const formatted = formatTimestamp(utcIso, {
    timeZone: timeZoneOverride,
    includeIcon: true,
    includeTimeZoneShort: true,
  });

  if (!formatted) {
    if (existingBadge && existingBadge.parentNode) {
      existingBadge.parentNode.removeChild(existingBadge);
    }
    return null;
  }

  const badge = existingBadge ?? doc.createElement('div');
  badge.setAttribute(BADGE_ATTR, kind);
  badge.setAttribute(BADGE_CLIP_ID_ATTR, clipId);
  badge.setAttribute(BADGE_UTC_ATTR, formatted.utcIso);
  badge.setAttribute('title', formatted.tooltipText);

  if (badge.textContent !== formatted.inlineText) {
    badge.textContent = formatted.inlineText;
  }

  return badge;
}

/**
 * Removes any existing timestamp badge inside `container`.
 */
export function removeBadgeFromContainer(container: Element): void {
  const badges = container.querySelectorAll(`[${BADGE_ATTR}]`);
  for (let i = 0; i < badges.length; i++) {
    const b = badges[i];
    if (b.parentNode) {
      b.parentNode.removeChild(b);
    }
  }
}

/**
 * Determines whether an element is inside a right-hand Song Detail panel / drawer / sidebar
 * rather than the main song list.
 */
export function isInsideDetailPanel(element: Element): boolean {
  const detailAncestor = element.closest(
    'aside, [role="complementary"], [data-testid*="detail"], [data-testid*="drawer"], [data-testid*="inspector"], [data-suno-detail-panel]',
  );
  if (detailAncestor) {
    return true;
  }

  // Heuristic for Suno's right-side detail panel when rendered as a flex/grid split pane:
  // If an ancestor is a narrow right-docked panel in the viewport (left >= 55% of viewport width)
  if (
    typeof window !== 'undefined' &&
    window.innerWidth >= 900 &&
    typeof element.getBoundingClientRect === 'function'
  ) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.left >= window.innerWidth * 0.58) {
      // Check if it looks like a detail panel (has larger artwork or lyrics section or single clip context)
      let curr: Element | null = element;
      let steps = 0;
      while (curr && steps < 8) {
        const songLinks = curr.querySelectorAll('a[href*="/song/"]');
        if (songLinks.length >= 1) {
          const ids = new Set<string>();
          for (let i = 0; i < songLinks.length; i++) {
            const id = extractClipIdFromUrl(songLinks[i].getAttribute('href'));
            if (id) ids.add(id);
          }
          // If this right-hand pane only references 1 clip and has substantial height, it's the detail panel
          const paneRect = curr.getBoundingClientRect();
          if (
            ids.size === 1 &&
            paneRect.left >= window.innerWidth * 0.55 &&
            paneRect.height >= 260
          ) {
            return true;
          }
        }
        curr = curr.parentElement;
        steps++;
      }
    }
  }

  return false;
}

/**
 * Finds the logical container for a single song row starting from a `/song/<uuid>` anchor link.
 * Walks up the DOM while the ancestor still contains only this single `clipId`
 * (stopping before reaching the list wrapper that holds multiple songs).
 */
export function findSingleSongContainer(
  anchor: Element,
  clipId: ClipId,
): Element {
  let current: Element = anchor;
  let steps = 0;
  const maxSteps = 6;

  while (current.parentElement && steps < maxSteps) {
    const parent = current.parentElement;
    const tag = parent.tagName.toLowerCase();
    if (tag === 'body' || tag === 'main' || tag === 'html') {
      break;
    }

    // Check if `parent` contains any `/song/<other_uuid>` link belonging to a different song
    const anchors = parent.querySelectorAll('a[href*="/song/"], a[href*="/clip/"]');
    let hasOtherClip = false;
    for (let i = 0; i < anchors.length; i++) {
      const otherId = extractClipIdFromUrl(anchors[i].getAttribute('href'));
      if (otherId && otherId !== clipId) {
        hasOtherClip = true;
        break;
      }
    }

    // Also check explicit data-clip-id / data-song-id attributes on descendants
    if (!hasOtherClip) {
      const dataNodes = parent.querySelectorAll(
        '[data-clip-id], [data-song-id], [data-track-id]',
      );
      for (let i = 0; i < dataNodes.length; i++) {
        const otherId = extractClipIdFromAttributes(dataNodes[i]);
        if (otherId && otherId !== clipId) {
          hasOtherClip = true;
          break;
        }
      }
    }

    if (hasOtherClip) {
      break;
    }

    current = parent;
    steps++;

    // Stop if we reached an explicit row boundary
    if (
      current.getAttribute('role') === 'row' ||
      current.getAttribute('role') === 'listitem' ||
      current.hasAttribute('data-clip-id') ||
      current.hasAttribute('data-song-id')
    ) {
      break;
    }
  }

  return current;
}

/**
 * Selects the best text/metadata container inside a song row or detail panel
 * so the timestamp appears directly below the title and style/model line.
 */
export function resolveMountPointForContainer(
  container: Element,
  primaryAnchor: Element | null,
): { mountPoint: Element; mountPosition: 'append' | 'after' } {
  if (primaryAnchor) {
    // Often the title anchor is inside a metadata column `<div>` that holds:
    //   1. Title row (`<a>Title</a>` + model badge)
    //   2. Style/tags line (`<div>Electro pop...</div>`)
    const anchorParent = primaryAnchor.parentElement;
    if (anchorParent && anchorParent !== container) {
      const grandParent = anchorParent.parentElement;
      if (
        grandParent &&
        grandParent !== container &&
        grandParent.children.length <= 5
      ) {
        return { mountPoint: grandParent, mountPosition: 'append' };
      }
      return { mountPoint: anchorParent, mountPosition: 'append' };
    }
    return { mountPoint: primaryAnchor, mountPosition: 'after' };
  }

  // When there is no anchor link (e.g. resolved via data-clip-id or React Fiber):
  // Look for a heading or title-like element inside the container
  const heading = container.querySelector(
    'h1, h2, h3, h4, [data-testid*="title"], [class*="title" i]',
  );
  if (heading && heading.parentElement && heading.parentElement !== container) {
    return { mountPoint: heading.parentElement, mountPosition: 'append' };
  }
  if (heading) {
    return { mountPoint: heading, mountPosition: 'after' };
  }

  return { mountPoint: container, mountPosition: 'append' };
}

/**
 * Discovers all song rows and detail panel targets currently in the DOM.
 */
export function discoverDomTargets(
  root: Document | Element = document,
  knownClipIds?: ReadonlySet<ClipId>,
): TargetDescriptor[] {
  const targets: TargetDescriptor[] = [];
  const processedContainers = new Set<Element>();

  // 1. Discover targets via `<a href="/song/<uuid>">` links
  const songAnchors = root.querySelectorAll('a[href*="/song/"], a[href*="/clip/"]');
  // Group anchors that belong to the same logical container so thumbnail + title links don't duplicate
  const anchorsByClip = new Map<ClipId, Element[]>();

  for (let i = 0; i < songAnchors.length; i++) {
    const anchor = songAnchors[i];
    const clipId = extractClipIdFromUrl(anchor.getAttribute('href'));
    if (!clipId) continue;

    // Prefer anchors with visible text (song title) over image-only thumbnail anchors
    const list = anchorsByClip.get(clipId) ?? [];
    list.push(anchor);
    anchorsByClip.set(clipId, list);
  }

  for (const [clipId, anchors] of anchorsByClip.entries()) {
    // Group anchors by their single-song container (remember: the same clip can appear in BOTH
    // the song list AND the right-hand detail panel at the same time!)
    const containerToBestAnchor = new Map<Element, Element>();

    for (const anchor of anchors) {
      const container = findSingleSongContainer(anchor, clipId);
      const existing = containerToBestAnchor.get(container);
      if (!existing) {
        containerToBestAnchor.set(container, anchor);
      } else {
        // Prefer an anchor that has non-empty textContent and no `<img>` child
        const existingHasText = (existing.textContent?.trim().length ?? 0) > 0;
        const currentHasText = (anchor.textContent?.trim().length ?? 0) > 0;
        const currentHasImg = anchor.querySelector('img') !== null;
        if (currentHasText && !currentHasImg && !existingHasText) {
          containerToBestAnchor.set(container, anchor);
        }
      }
    }

    for (const [container, bestAnchor] of containerToBestAnchor.entries()) {
      if (processedContainers.has(container)) {
        continue;
      }
      processedContainers.add(container);

      const kind: BadgeTargetKind = isInsideDetailPanel(container)
        ? 'detail'
        : 'row';
      const { mountPoint, mountPosition } = resolveMountPointForContainer(
        container,
        bestAnchor,
      );

      targets.push({
        kind,
        container,
        mountPoint,
        mountPosition,
        clipId,
      });
    }
  }

  // 2. Discover targets with explicit `[data-clip-id]`, `[data-song-id]`, `[data-track-id]`
  // that did not have an `<a href="/song/...">` link
  const explicitNodes = root.querySelectorAll(
    '[data-clip-id], [data-song-id], [data-track-id]',
  );
  for (let i = 0; i < explicitNodes.length; i++) {
    const node = explicitNodes[i];
    if (processedContainers.has(node)) {
      continue;
    }
    // Skip if already inside a processed container for the same clip
    const clipId = extractClipIdFromAttributes(node);
    if (!clipId) {
      continue;
    }

    let alreadyCovered = false;
    for (const done of processedContainers) {
      if (done.contains(node) || node.contains(done)) {
        const existingBadge = done.querySelector(`[${BADGE_CLIP_ID_ATTR}="${clipId}"]`);
        if (existingBadge) {
          alreadyCovered = true;
          break;
        }
      }
    }
    if (alreadyCovered) {
      continue;
    }

    processedContainers.add(node);
    const kind: BadgeTargetKind = isInsideDetailPanel(node) ? 'detail' : 'row';
    const { mountPoint, mountPosition } = resolveMountPointForContainer(
      node,
      null,
    );

    targets.push({
      kind,
      container: node,
      mountPoint,
      mountPosition,
      clipId,
    });
  }

  // 3. Check right-hand detail panel (`aside` / `[data-suno-detail-panel]`) if it didn't have a `/song/` link
  const detailPanels = root.querySelectorAll(
    'aside, [role="complementary"], [data-testid*="detail"], [data-suno-detail-panel]',
  );
  for (let i = 0; i < detailPanels.length; i++) {
    const panel = detailPanels[i];
    let hasDetailTarget = false;
    for (const t of targets) {
      if (panel.contains(t.container) || t.container.contains(panel)) {
        t.kind = 'detail';
        hasDetailTarget = true;
      }
    }
    if (!hasDetailTarget && !processedContainers.has(panel)) {
      const panelClipId = extractClipIdFromElement(panel, knownClipIds);
      if (panelClipId) {
        processedContainers.add(panel);
        const { mountPoint, mountPosition } = resolveMountPointForContainer(
          panel,
          null,
        );
        targets.push({
          kind: 'detail',
          container: panel,
          mountPoint,
          mountPosition,
          clipId: panelClipId,
        });
      }
    }
  }

  // 4. Standalone `/song/<uuid>` page header support
  if (typeof location !== 'undefined') {
    const pageClipId = extractClipIdFromLocation(
      location.pathname,
      location.search,
    );
    if (pageClipId) {
      const hasDetailAlready = targets.some(
        (t) => t.kind === 'detail' && t.clipId === pageClipId,
      );
      if (!hasDetailAlready) {
        const mainHeading = root.querySelector('main h1, h1');
        if (mainHeading && mainHeading.parentElement) {
          const container = mainHeading.parentElement;
          if (!processedContainers.has(container)) {
            processedContainers.add(container);
            targets.push({
              kind: 'detail',
              container,
              mountPoint: mainHeading,
              mountPosition: 'after',
              clipId: pageClipId,
            });
          }
        }
      }
    }
  }

  return targets;
}

/**
 * Renders or updates the timestamp badge for a single `TargetDescriptor`.
 * If `utcIso` is `null` (unknown), removes any stale badge so wrong data is never shown.
 */
export function applyTimestampToTarget(
  target: TargetDescriptor,
  utcIso: string | null,
  options: { doc?: Document; timeZone?: string } = {},
): HTMLElement | null {
  const doc = options.doc ?? document;
  ensureStylesInjected(doc);

  const existingBadge = target.container.querySelector(
    `[${BADGE_ATTR}]`,
  ) as HTMLElement | null;

  // Remove any extra duplicate badges if the container somehow acquired more than one
  const allBadges = target.container.querySelectorAll(`[${BADGE_ATTR}]`);
  if (allBadges.length > 1) {
    for (let i = 1; i < allBadges.length; i++) {
      allBadges[i].parentNode?.removeChild(allBadges[i]);
    }
  }

  if (!utcIso) {
    // Unknown timestamp -> remove stale badge if it belonged to a different clip or cannot be verified
    if (existingBadge) {
      existingBadge.parentNode?.removeChild(existingBadge);
    }
    return null;
  }

  const badge = createOrUpdateBadgeElement(
    doc,
    existingBadge,
    target.kind,
    target.clipId,
    utcIso,
    options.timeZone,
  );

  if (!badge) {
    return null;
  }

  target.container.setAttribute(TARGET_BOUND_ATTR, target.clipId);

  // Attach badge if not yet in DOM
  if (!badge.parentNode) {
    if (target.mountPosition === 'after' && target.mountPoint.parentNode) {
      target.mountPoint.parentNode.insertBefore(
        badge,
        target.mountPoint.nextSibling,
      );
    } else {
      target.mountPoint.appendChild(badge);
    }
  }

  return badge;
}

/**
 * Coordinates scanning the DOM, probing React Fiber for rows without explicit links,
 * and applying timestamps from `TimestampProvider`.
 */
export class SunoTimestampUIController {
  private readonly provider: TimestampProvider;
  private readonly timeZoneOverride?: string;
  private readonly probedElements = new WeakSet<Element>();

  constructor(
    provider: TimestampProvider,
    options: { timeZoneOverride?: string } = {},
  ) {
    this.provider = provider;
    this.timeZoneOverride = options.timeZoneOverride;
  }

  /**
   * Synchronizes all discoverable song rows and detail panels in `root`.
   */
  public async refresh(root: Document | Element = document): Promise<void> {
    // 1. First check if any candidate row/detail panel without a Clip ID can be resolved via React Fiber
    await this.probeUnlinkedCandidates(root);

    // 2. Discover all targets with verified Clip IDs
    const targets = discoverDomTargets(root, this.provider.getKnownClipIds());
    if (targets.length === 0) {
      return;
    }

    const uncachedClipIds = new Set<ClipId>();

    // 3. Immediately render cached timestamps synchronously for zero-flicker UX
    for (const target of targets) {
      const cachedIso = this.provider.getCachedTimestamp(target.clipId);
      if (cachedIso) {
        applyTimestampToTarget(target, cachedIso, {
          timeZone: this.timeZoneOverride,
        });
      } else {
        // Clear any stale badge from a recycled DOM node!
        const existingBadge = target.container.querySelector(`[${BADGE_ATTR}]`);
        if (
          existingBadge &&
          existingBadge.getAttribute(BADGE_CLIP_ID_ATTR) !== target.clipId
        ) {
          existingBadge.parentNode?.removeChild(existingBadge);
        }

        // Only queue visible (or detail panel) elements for async resolution
        if (target.kind === 'detail' || this.isNearViewport(target.container)) {
          uncachedClipIds.add(target.clipId);
        }
      }
    }

    // 4. For any visible target whose timestamp is not yet cached, try probing its React Fiber first
    for (const target of targets) {
      if (uncachedClipIds.has(target.clipId)) {
        const fiberData = await this.provider.probeElementForClip(
          target.container,
        );
        if (
          fiberData &&
          fiberData.clipId === target.clipId &&
          fiberData.createdAtIso
        ) {
          uncachedClipIds.delete(target.clipId);
          applyTimestampToTarget(target, fiberData.createdAtIso, {
            timeZone: this.timeZoneOverride,
          });
        }
      }
    }

    // 5. Fallback batch resolution for any remaining visible uncached clips
    if (uncachedClipIds.size > 0) {
      const resolvedMap = await this.provider.resolveTimestampsBatch(
        Array.from(uncachedClipIds),
      );
      if (resolvedMap.size > 0) {
        for (const target of targets) {
          const iso =
            resolvedMap.get(target.clipId) ??
            this.provider.getCachedTimestamp(target.clipId);
          if (iso) {
            applyTimestampToTarget(target, iso, {
              timeZone: this.timeZoneOverride,
            });
          }
        }
      }
    }
  }

  /**
   * Probes candidate row/detail elements that lack `/song/<uuid>` links so React Fiber props
   * can attach `data-clip-id` if a single clip is mounted on them.
   */
  private async probeUnlinkedCandidates(
    root: Document | Element,
  ): Promise<void> {
    const candidates = root.querySelectorAll(
      '[role="row"], [data-testid*="song-row"], [data-testid*="clip-row"], [data-testid*="track-row"], aside, [role="complementary"]',
    );

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (this.probedElements.has(el)) {
        continue;
      }

      // Skip if it already has a clip ID attribute or a `/song/` link
      if (
        extractClipIdFromAttributes(el) ||
        el.querySelector('a[href*="/song/"], a[href*="/clip/"]')
      ) {
        continue;
      }

      if (!this.isNearViewport(el)) {
        continue;
      }

      this.probedElements.add(el);
      const fiberResult = await this.provider.probeElementForClip(el);
      if (fiberResult) {
        const normalized = normalizeClipId(fiberResult.clipId);
        if (normalized) {
          el.setAttribute('data-clip-id', normalized);
        }
      }
    }
  }

  private isNearViewport(element: Element): boolean {
    if (
      typeof window === 'undefined' ||
      typeof element.getBoundingClientRect !== 'function'
    ) {
      return true;
    }
    const rect = element.getBoundingClientRect();
    // In JSDOM or zero-layout environments, rect.height and rect.width are 0 -> treat as visible
    if (rect.width === 0 && rect.height === 0) {
      return true;
    }
    const margin = 400;
    return (
      rect.bottom >= -margin &&
      rect.top <= (window.innerHeight || 1000) + margin
    );
  }
}
