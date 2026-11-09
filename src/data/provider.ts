import type { ClipId, RawTimestampInput } from '../shared/types.js';
import type { CacheUpdateListener } from './cache.js';

export interface FiberProbeData {
  clipId: ClipId;
  createdAtIso: string | null;
}

/**
 * Abstraction for resolving Suno Clip creation timestamps.
 */
export interface TimestampProvider {
  /**
   * Synchronously returns the cached UTC ISO timestamp for `clipId`, or `null` if not in memory.
   */
  getCachedTimestamp(clipId: ClipId): string | null;

  /**
   * Asynchronously resolves the UTC ISO timestamp for `clipId` (Cache -> Passive/Fiber -> Fallback).
   * Returns `null` if unavailable. Never returns guessed data.
   */
  resolveTimestamp(clipId: ClipId): Promise<string | null>;

  /**
   * Resolves timestamps for a batch of visible `clipIds`.
   */
  resolveTimestampsBatch(
    clipIds: ReadonlyArray<ClipId>,
  ): Promise<ReadonlyMap<ClipId, string>>;

  /**
   * Ingests clip records discovered from page network responses or hydration data.
   */
  ingestClips(
    entries: ReadonlyArray<{ id: string; createdAt: RawTimestampInput }>,
  ): ClipId[];

  /**
   * Requests the MAIN world bridge to inspect React Fiber props on `element` (or its ancestors)
   * to discover both `clipId` and `created_at` without network requests.
   */
  probeElementForClip(element: Element): Promise<FiberProbeData | null>;

  /**
   * Returns all verified Clip IDs currently known to the provider.
   */
  getKnownClipIds(): ReadonlySet<ClipId>;

  /**
   * Subscribes to newly discovered/cached clip timestamps.
   */
  onUpdate(listener: CacheUpdateListener): () => void;
}
