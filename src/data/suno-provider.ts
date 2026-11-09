import { normalizeClipId } from '../content/clip-id.js';
import { parseTimestamp } from '../shared/datetime.js';
import type {
  ClipId,
  PageBridgeClipsMessage,
  PageBridgeFiberProbeResponse,
  RawTimestampInput,
} from '../shared/types.js';
import type { CacheUpdateListener, ClipTimestampCache } from './cache.js';
import type { FiberProbeData, TimestampProvider } from './provider.js';

const MAX_TRAVERSAL_DEPTH = 12;
const MAX_TRAVERSAL_NODES = 10_000;
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
const PROBE_TIMEOUT_MS = 150;

export interface DiscoveredClipEntry {
  id: ClipId;
  createdAt: string | number;
}

/**
 * Recursively traverses a parsed JSON payload (from Suno API or Next.js state)
 * and extracts all valid `{ id, createdAt }` clip pairs.
 */
export function extractClipsFromJsonPayload(
  payload: unknown,
): DiscoveredClipEntry[] {
  const results = new Map<ClipId, string | number>();
  const visited = new WeakSet<object>();
  let nodesVisited = 0;

  function visit(node: unknown, depth: number): void {
    if (
      node === null ||
      node === undefined ||
      typeof node !== 'object' ||
      depth > MAX_TRAVERSAL_DEPTH ||
      nodesVisited >= MAX_TRAVERSAL_NODES
    ) {
      return;
    }

    if (visited.has(node)) {
      return;
    }
    visited.add(node);
    nodesVisited++;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        visit(node[i], depth + 1);
      }
      return;
    }

    const record = node as Record<string, unknown>;

    // Check if this object itself represents a clip with `id` and `created_at`
    // Exclude container objects that own `project_clips` or `playlist_clips`
    const isContainerObject =
      Array.isArray(record.project_clips) || Array.isArray(record.playlist_clips);

    if (!isContainerObject) {
      const candidateId = normalizeClipId(record.id ?? record.clip_id);
      const rawCreated =
        record.created_at ??
        record.createdAt ??
        (record.metadata &&
        typeof record.metadata === 'object' &&
        record.metadata !== null
          ? (record.metadata as Record<string, unknown>).created_at
          : undefined);

      if (
        candidateId &&
        (typeof rawCreated === 'string' || typeof rawCreated === 'number')
      ) {
        const parsed = parseTimestamp(rawCreated);
        if (parsed) {
          results.set(candidateId, parsed.utcIso);
        }
      }
    }

    // Traverse child properties
    for (const value of Object.values(record)) {
      if (value !== null && typeof value === 'object') {
        visit(value, depth + 1);
      }
    }
  }

  visit(payload, 0);

  return Array.from(results.entries()).map(([id, createdAt]) => ({
    id,
    createdAt,
  }));
}

/**
 * Safely extracts `{ id, created_at }` pairs from Next.js Flight / SSR serialized text
 * when both fields appear within the same flat JSON object segment.
 */
export function extractClipsFromSerializedText(
  text: string,
): DiscoveredClipEntry[] {
  if (!text || typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const results = new Map<ClipId, string>();

  // Pattern 1: "id":"<uuid>" followed closely by "created_at":"<iso>" without crossing object boundaries
  const idFirstRegex =
    /\\?"id\\?"\s*:\s*\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\?"[^{}]{0,800}?\\?"created_at\\?"\s*:\s*\\?"([^"\\]+)\\?"/gi;

  let match: RegExpExecArray | null;
  while ((match = idFirstRegex.exec(text)) !== null) {
    const id = normalizeClipId(match[1]);
    const parsed = parseTimestamp(match[2]);
    if (id && parsed) {
      results.set(id, parsed.utcIso);
    }
  }

  // Pattern 2: "created_at":"<iso>" followed closely by "id":"<uuid>"
  const createdFirstRegex =
    /\\?"created_at\\?"\s*:\s*\\?"([^"\\]+)\\?"[^{}]{0,800}?\\?"id\\?"\s*:\s*\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\?"/gi;

  while ((match = createdFirstRegex.exec(text)) !== null) {
    const parsed = parseTimestamp(match[1]);
    const id = normalizeClipId(match[2]);
    if (id && parsed) {
      results.set(id, parsed.utcIso);
    }
  }

  return Array.from(results.entries()).map(([id, createdAt]) => ({
    id,
    createdAt,
  }));
}

/**
 * Concrete TimestampProvider implementation for Suno.
 *
 * Priority order:
 * A. Passive reuse of page responses (Fetch/XHR/Next.js SSR) & React Fiber inspection via MAIN world bridge.
 * B. Rate-limited, same-origin read-only fallback when necessary.
 * C. Local persistent & in-memory cache.
 */
export class SunoTimestampProvider implements TimestampProvider {
  private readonly cache: ClipTimestampCache;
  private readonly inFlightRequests = new Map<ClipId, Promise<string | null>>();
  private readonly negativeCache = new Map<ClipId, number>();
  private readonly pendingProbes = new Map<
    string,
    (data: FiberProbeData | null) => void
  >();

  private probeCounter = 0;
  private consecutiveFailures = 0;
  private backoffUntilMs = 0;
  private enableFallbackFetch: boolean;

  constructor(
    cache: ClipTimestampCache,
    options: { enableFallbackFetch?: boolean } = {},
  ) {
    this.cache = cache;
    this.enableFallbackFetch = options.enableFallbackFetch ?? true;
    this.setupBridgeListener();
  }

  public getCachedTimestamp(clipId: ClipId): string | null {
    return this.cache.get(clipId);
  }

  public ingestClips(
    entries: ReadonlyArray<{ id: string; createdAt: RawTimestampInput }>,
  ): ClipId[] {
    return this.cache.setMany(entries);
  }

  public getKnownClipIds(): ReadonlySet<ClipId> {
    return this.cache.getKnownClipIds();
  }

  public onUpdate(listener: CacheUpdateListener): () => void {
    return this.cache.subscribe(listener);
  }

  /**
   * Scans initial Next.js SSR data (`__NEXT_DATA__` or inline flight scripts) present in the DOM.
   */
  public scanInitialPageScripts(root: Document | Element = document): number {
    let discoveredCount = 0;

    try {
      const nextDataEl =
        'getElementById' in root ? root.getElementById('__NEXT_DATA__') : null;
      if (nextDataEl?.textContent) {
        const parsed = JSON.parse(nextDataEl.textContent) as unknown;
        const clips = extractClipsFromJsonPayload(parsed);
        if (clips.length > 0) {
          discoveredCount += this.ingestClips(clips).length;
        }
      }
    } catch {
      // Ignore malformed __NEXT_DATA__
    }

    try {
      const scripts = root.querySelectorAll('script:not([src])');
      const batch: DiscoveredClipEntry[] = [];
      for (let i = 0; i < scripts.length; i++) {
        const content = scripts[i].textContent;
        if (
          content &&
          content.includes('created_at') &&
          (content.includes('__next_f') || content.includes('"clips"'))
        ) {
          const found = extractClipsFromSerializedText(content);
          for (const item of found) {
            batch.push(item);
          }
        }
      }
      if (batch.length > 0) {
        discoveredCount += this.ingestClips(batch).length;
      }
    } catch {
      // Ignore script scan errors
    }

    return discoveredCount;
  }

  /**
   * Probes a DOM element's React Fiber in the MAIN world to extract `clipId` and `created_at`
   * directly from the mounted React component props.
   */
  public probeElementForClip(element: Element): Promise<FiberProbeData | null> {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') {
      return Promise.resolve(null);
    }

    const probeId = `probe_${Date.now()}_${++this.probeCounter}`;
    element.setAttribute('data-suno-ts-probe-id', probeId);

    return new Promise<FiberProbeData | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingProbes.delete(probeId);
        element.removeAttribute('data-suno-ts-probe-id');
        resolve(null);
      }, PROBE_TIMEOUT_MS);

      this.pendingProbes.set(probeId, (result) => {
        clearTimeout(timer);
        element.removeAttribute('data-suno-ts-probe-id');
        resolve(result);
      });

      try {
        window.dispatchEvent(
          new CustomEvent('suno-ts-probe-request', {
            detail: { probeId },
          }),
        );
      } catch {
        clearTimeout(timer);
        this.pendingProbes.delete(probeId);
        element.removeAttribute('data-suno-ts-probe-id');
        resolve(null);
      }
    });
  }

  /**
   * Resolves a single Clip's creation timestamp.
   */
  public async resolveTimestamp(clipId: ClipId): Promise<string | null> {
    const normalized = normalizeClipId(clipId);
    if (!normalized) {
      return null;
    }

    // 1. Check memory cache first (Priority C / A)
    const cached = this.cache.get(normalized);
    if (cached) {
      return cached;
    }

    if (!this.enableFallbackFetch) {
      return null;
    }

    // 2. Check negative cache & backoff
    const now = Date.now();
    if (now < this.backoffUntilMs) {
      return null;
    }
    const lastFailedAt = this.negativeCache.get(normalized);
    if (lastFailedAt !== undefined && now - lastFailedAt < NEGATIVE_CACHE_TTL_MS) {
      return null;
    }

    // 3. Deduplicate concurrent requests for the same Clip ID
    const existingPromise = this.inFlightRequests.get(normalized);
    if (existingPromise) {
      return existingPromise;
    }

    const requestPromise = this.fetchClipTimestampFallback(normalized).finally(
      () => {
        this.inFlightRequests.delete(normalized);
      },
    );
    this.inFlightRequests.set(normalized, requestPromise);
    return requestPromise;
  }

  /**
   * Resolves timestamps for a batch of visible Clip IDs.
   */
  public async resolveTimestampsBatch(
    clipIds: ReadonlyArray<ClipId>,
  ): Promise<ReadonlyMap<ClipId, string>> {
    const result = new Map<ClipId, string>();
    const missing: ClipId[] = [];

    for (const rawId of clipIds) {
      const id = normalizeClipId(rawId);
      if (!id) continue;
      const cached = this.cache.get(id);
      if (cached) {
        result.set(id, cached);
      } else {
        missing.push(id);
      }
    }

    if (missing.length === 0 || !this.enableFallbackFetch) {
      return result;
    }

    // Limit concurrent fallback requests to avoid bursts on large libraries
    const maxBatch = missing.slice(0, 6);
    await Promise.all(
      maxBatch.map(async (id) => {
        const resolved = await this.resolveTimestamp(id);
        if (resolved) {
          result.set(id, resolved);
        }
      }),
    );

    return result;
  }

  /**
   * Priority B fallback: read-only same-origin request for a specific clip when passive capture
   * did not already provide its timestamp.
   */
  private async fetchClipTimestampFallback(
    clipId: ClipId,
  ): Promise<string | null> {
    if (typeof fetch !== 'function' || typeof location === 'undefined') {
      return null;
    }

    // Only run on suno.com origin
    if (!location.hostname.endsWith('suno.com')) {
      return null;
    }

    try {
      // Request the public/same-origin song page with RSC header or HTML to extract clip metadata passively
      const url = `${location.origin}/song/${encodeURIComponent(clipId)}`;
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9',
        },
      });

      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        this.recordFailure();
        this.negativeCache.set(clipId, Date.now());
        return null;
      }

      if (!response.ok) {
        this.negativeCache.set(clipId, Date.now());
        return null;
      }

      this.consecutiveFailures = 0;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const json = (await response.json()) as unknown;
        const clips = extractClipsFromJsonPayload(json);
        this.ingestClips(clips);
      } else {
        const text = await response.text();
        const clips = extractClipsFromSerializedText(text);
        this.ingestClips(clips);
      }

      const resolved = this.cache.get(clipId);
      if (!resolved) {
        this.negativeCache.set(clipId, Date.now());
      }
      return resolved;
    } catch {
      this.recordFailure();
      this.negativeCache.set(clipId, Date.now());
      return null;
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * Math.pow(2, this.consecutiveFailures - 1),
    );
    this.backoffUntilMs = Date.now() + delay;
  }

  private setupBridgeListener(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') {
        return;
      }

      const data = event.data as
        | PageBridgeClipsMessage
        | PageBridgeFiberProbeResponse;

      if (data.source !== 'suno-timestamp-extension-main') {
        return;
      }

      if (data.type === 'CLIPS_DISCOVERED' && Array.isArray(data.clips)) {
        this.ingestClips(data.clips);
        return;
      }

      if (
        data.type === 'FIBER_PROBE_RESULT' &&
        typeof data.probeId === 'string'
      ) {
        const callback = this.pendingProbes.get(data.probeId);
        if (!callback) {
          return;
        }
        this.pendingProbes.delete(data.probeId);

        const normalizedId = normalizeClipId(data.clipId);
        if (!normalizedId) {
          callback(null);
          return;
        }

        let createdAtIso: string | null = null;
        if (data.createdAt !== null && data.createdAt !== undefined) {
          const parsed = parseTimestamp(data.createdAt);
          if (parsed) {
            createdAtIso = parsed.utcIso;
            this.cache.set(normalizedId, parsed.utcIso);
          }
        } else {
          createdAtIso = this.cache.get(normalizedId);
        }

        callback({
          clipId: normalizedId,
          createdAtIso,
        });
      }
    });
  }
}
