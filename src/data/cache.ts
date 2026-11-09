import { normalizeClipId } from '../content/clip-id.js';
import { parseTimestamp } from '../shared/datetime.js';
import type { ClipId, ClipTimestampRecord, RawTimestampInput } from '../shared/types.js';

const STORAGE_KEY = 'suno_timestamp_cache_v1';
const MAX_CACHE_ENTRIES = 5000;
const STORAGE_FLUSH_DEBOUNCE_MS = 500;

export type CacheUpdateListener = (updatedClipIds: ClipId[]) => void;

interface StoredCachePayload {
  version: 1;
  records: Record<ClipId, ClipTimestampRecord>;
}

/**
 * Two-tier (Memory + chrome.storage.local) cache mapping `ClipId -> ClipTimestampRecord`.
 * Creation timestamps of clips are immutable, so cached entries remain valid across reloads.
 */
export class ClipTimestampCache {
  private readonly memory = new Map<ClipId, ClipTimestampRecord>();
  private readonly knownIds = new Set<ClipId>();
  private readonly listeners = new Set<CacheUpdateListener>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isDirty = false;

  /**
   * Loads persisted records from `chrome.storage.local` if available in the current environment.
   */
  public async hydrate(): Promise<void> {
    if (
      typeof chrome === 'undefined' ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return;
    }

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const payload = result?.[STORAGE_KEY] as StoredCachePayload | undefined;
      if (!payload || payload.version !== 1 || !payload.records) {
        return;
      }

      const newlyLoaded: ClipId[] = [];
      for (const [rawId, record] of Object.entries(payload.records)) {
        const clipId = normalizeClipId(rawId);
        if (!clipId || !record || typeof record.createdAtIso !== 'string') {
          continue;
        }
        const parsed = parseTimestamp(record.createdAtIso);
        if (!parsed) {
          continue;
        }
        if (!this.memory.has(clipId)) {
          this.memory.set(clipId, {
            clipId,
            createdAtIso: parsed.utcIso,
            fetchedAt:
              typeof record.fetchedAt === 'number' && Number.isFinite(record.fetchedAt)
                ? record.fetchedAt
                : Date.now(),
          });
          this.knownIds.add(clipId);
          newlyLoaded.push(clipId);
        }
      }

      if (newlyLoaded.length > 0) {
        this.notifyListeners(newlyLoaded);
      }
    } catch {
      // Ignore storage access errors (e.g. extension context invalidated)
    }
  }

  /**
   * Retrieves a cached UTC ISO timestamp for the given `clipId`, or `null` if not cached.
   */
  public get(clipId: string): string | null {
    const normalized = normalizeClipId(clipId);
    if (!normalized) {
      return null;
    }
    const record = this.memory.get(normalized);
    return record ? record.createdAtIso : null;
  }

  /**
   * Retrieves the full cached record for the given `clipId`, or `null`.
   */
  public getRecord(clipId: string): ClipTimestampRecord | null {
    const normalized = normalizeClipId(clipId);
    if (!normalized) {
      return null;
    }
    return this.memory.get(normalized) ?? null;
  }

  /**
   * Stores a single `clipId -> createdAt` entry after validating both ID and timestamp.
   * Returns `true` if a new or updated record was stored.
   */
  public set(clipId: string, rawCreatedAt: RawTimestampInput): boolean {
    const normalizedId = normalizeClipId(clipId);
    if (!normalizedId) {
      return false;
    }
    const parsed = parseTimestamp(rawCreatedAt);
    if (!parsed) {
      return false;
    }

    const existing = this.memory.get(normalizedId);
    if (existing && existing.createdAtIso === parsed.utcIso) {
      return false;
    }

    this.memory.set(normalizedId, {
      clipId: normalizedId,
      createdAtIso: parsed.utcIso,
      fetchedAt: Date.now(),
    });
    this.knownIds.add(normalizedId);
    this.isDirty = true;
    this.scheduleFlush();
    this.notifyListeners([normalizedId]);
    return true;
  }

  /**
   * Stores multiple clips at once and triggers a single batched notification.
   * Returns the list of newly stored or updated `ClipId`s.
   */
  public setMany(
    entries: ReadonlyArray<{ id: string; createdAt: RawTimestampInput }>,
  ): ClipId[] {
    const updated: ClipId[] = [];
    const now = Date.now();

    for (const entry of entries) {
      const normalizedId = normalizeClipId(entry.id);
      if (!normalizedId) {
        continue;
      }
      const parsed = parseTimestamp(entry.createdAt);
      if (!parsed) {
        continue;
      }

      const existing = this.memory.get(normalizedId);
      if (existing && existing.createdAtIso === parsed.utcIso) {
        continue;
      }

      this.memory.set(normalizedId, {
        clipId: normalizedId,
        createdAtIso: parsed.utcIso,
        fetchedAt: now,
      });
      this.knownIds.add(normalizedId);
      updated.push(normalizedId);
    }

    if (updated.length > 0) {
      this.isDirty = true;
      this.scheduleFlush();
      this.notifyListeners(updated);
    }

    return updated;
  }

  /**
   * Returns the set of all known valid Clip IDs stored in the cache.
   */
  public getKnownClipIds(): ReadonlySet<ClipId> {
    return this.knownIds;
  }

  /**
   * Returns the total number of cached clips.
   */
  public get size(): number {
    return this.memory.size;
  }

  /**
   * Subscribes to cache updates. Returns an unsubscribe function.
   */
  public subscribe(listener: CacheUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(updatedIds: ClipId[]): void {
    for (const listener of this.listeners) {
      try {
        listener(updatedIds);
      } catch {
        // Prevent listener errors from breaking cache flow
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushToStorage();
    }, STORAGE_FLUSH_DEBOUNCE_MS);
  }

  private async flushToStorage(): Promise<void> {
    if (!this.isDirty) {
      return;
    }
    if (
      typeof chrome === 'undefined' ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return;
    }

    this.isDirty = false;

    try {
      // Prune oldest entries if cache exceeds MAX_CACHE_ENTRIES
      if (this.memory.size > MAX_CACHE_ENTRIES) {
        const sorted = Array.from(this.memory.values()).sort(
          (a, b) => a.fetchedAt - b.fetchedAt,
        );
        const toRemoveCount = this.memory.size - MAX_CACHE_ENTRIES;
        for (let i = 0; i < toRemoveCount; i++) {
          this.memory.delete(sorted[i].clipId);
        }
      }

      const records: Record<ClipId, ClipTimestampRecord> = {};
      for (const [clipId, record] of this.memory.entries()) {
        records[clipId] = record;
      }

      const payload: StoredCachePayload = {
        version: 1,
        records,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } catch {
      // Ignore storage quota or context invalidation errors
    }
  }
}
