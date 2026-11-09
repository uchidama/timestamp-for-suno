import {
  BADGE_ATTR,
  BADGE_CLIP_ID_ATTR,
  BADGE_UTC_ATTR,
  TARGET_BOUND_ATTR,
} from './ui.js';

export interface DomObserverOptions {
  /** Debounce delay in milliseconds before running the refresh callback (default: 80ms) */
  debounceMs?: number;
  /** Maximum delay during continuous mutations before forcing a refresh (default: 350ms) */
  maxWaitMs?: number;
  /** Scroll throttle interval in milliseconds (default: 200ms) */
  scrollThrottleMs?: number;
}

const IGNORED_ATTRIBUTES = new Set([
  BADGE_ATTR,
  BADGE_CLIP_ID_ATTR,
  BADGE_UTC_ATTR,
  TARGET_BOUND_ATTR,
  'data-suno-ts-probe-id',
]);

/**
 * Checks whether a DOM node is one of our injected timestamp badges.
 */
function isOwnBadgeNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const el = node as Element;
  return (
    el.hasAttribute(BADGE_ATTR) ||
    el.id === 'suno-timestamp-extension-styles'
  );
}

/**
 * Checks whether a MutationRecord was caused solely by our own badge injection/update.
 */
function isSelfMutation(mutation: MutationRecord): boolean {
  if (mutation.type === 'attributes') {
    if (
      mutation.attributeName &&
      IGNORED_ATTRIBUTES.has(mutation.attributeName)
    ) {
      return true;
    }
    return isOwnBadgeNode(mutation.target);
  }

  if (mutation.type === 'childList') {
    if (isOwnBadgeNode(mutation.target)) {
      return true;
    }

    let hasExternalNode = false;
    for (let i = 0; i < mutation.addedNodes.length; i++) {
      const node = mutation.addedNodes[i];
      if (node.nodeType === Node.ELEMENT_NODE && !isOwnBadgeNode(node)) {
        hasExternalNode = true;
        break;
      }
    }
    if (!hasExternalNode) {
      for (let i = 0; i < mutation.removedNodes.length; i++) {
        const node = mutation.removedNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE && !isOwnBadgeNode(node)) {
          hasExternalNode = true;
          break;
        }
      }
    }
    return !hasExternalNode;
  }

  return true;
}

/**
 * Observes Suno SPA DOM updates, attribute changes (such as detail panel switching),
 * route navigation, and scrolling with debouncing/throttling.
 */
export class SunoDomObserver {
  private readonly onRefresh: () => void | Promise<void>;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly scrollThrottleMs: number;

  private mutationObserver: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingTimestamp: number | null = null;
  private lastScrollHandledAt = 0;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private isStarted = false;

  private readonly boundScrollHandler: () => void;
  private readonly boundNavigationHandler: () => void;

  constructor(
    onRefresh: () => void | Promise<void>,
    options: DomObserverOptions = {},
  ) {
    this.onRefresh = onRefresh;
    this.debounceMs = options.debounceMs ?? 80;
    this.maxWaitMs = options.maxWaitMs ?? 350;
    this.scrollThrottleMs = options.scrollThrottleMs ?? 200;

    this.boundScrollHandler = this.handleScroll.bind(this);
    this.boundNavigationHandler = this.handleNavigation.bind(this);
  }

  /**
   * Starts observing `root` (defaults to `document.body` or `document.documentElement`).
   */
  public start(root: Element = document.body ?? document.documentElement): void {
    if (this.isStarted || !root) {
      return;
    }
    this.isStarted = true;

    this.mutationObserver = new MutationObserver((mutations) => {
      let hasRelevantMutation = false;
      for (let i = 0; i < mutations.length; i++) {
        if (!isSelfMutation(mutations[i])) {
          hasRelevantMutation = true;
          break;
        }
      }
      if (hasRelevantMutation) {
        this.scheduleRefresh();
      }
    });

    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'data-clip-id', 'data-song-id', 'data-track-id', 'src'],
    });

    if (typeof window !== 'undefined') {
      // Capture=true ensures scroll events inside nested overflow containers in Suno are caught
      window.addEventListener('scroll', this.boundScrollHandler, {
        capture: true,
        passive: true,
      });
      window.addEventListener('popstate', this.boundNavigationHandler, {
        passive: true,
      });
      window.addEventListener(
        'suno-ts-location-change',
        this.boundNavigationHandler,
      );
    }
  }

  /**
   * Stops all observers and timers.
   */
  public stop(): void {
    if (!this.isStarted) {
      return;
    }
    this.isStarted = false;

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.scrollTimer !== null) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.firstPendingTimestamp = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.boundScrollHandler, {
        capture: true,
      });
      window.removeEventListener('popstate', this.boundNavigationHandler);
      window.removeEventListener(
        'suno-ts-location-change',
        this.boundNavigationHandler,
      );
    }
  }

  /**
   * Schedules a debounced refresh with `maxWaitMs` guarantee.
   */
  public scheduleRefresh(): void {
    const now = Date.now();
    if (this.firstPendingTimestamp === null) {
      this.firstPendingTimestamp = now;
    }

    const elapsed = now - this.firstPendingTimestamp;
    if (elapsed >= this.maxWaitMs) {
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.firstPendingTimestamp = null;
      this.invokeRefresh();
      return;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    const remainingMax = this.maxWaitMs - elapsed;
    const delay = Math.min(this.debounceMs, remainingMax);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.firstPendingTimestamp = null;
      this.invokeRefresh();
    }, delay);
  }

  private handleScroll(): void {
    const now = Date.now();
    const elapsed = now - this.lastScrollHandledAt;
    if (elapsed >= this.scrollThrottleMs) {
      this.lastScrollHandledAt = now;
      this.scheduleRefresh();
      return;
    }
    if (this.scrollTimer === null) {
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = null;
        this.lastScrollHandledAt = Date.now();
        this.scheduleRefresh();
      }, this.scrollThrottleMs - elapsed);
    }
  }

  private handleNavigation(): void {
    this.scheduleRefresh();
  }

  private invokeRefresh(): void {
    try {
      void this.onRefresh();
    } catch {
      // Never throw into observer callback
    }
  }
}
