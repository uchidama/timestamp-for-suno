/**
 * Validated lowercase UUID representing a Suno Clip ID.
 */
export type ClipId = string;

/**
 * Raw timestamp input accepted by the parser.
 */
export type RawTimestampInput = string | number | null | undefined;

/**
 * Result of parsing a raw timestamp value.
 */
export interface ParsedTimestamp {
  /** Epoch milliseconds in UTC */
  epochMs: number;
  /** Canonical UTC ISO-8601 string (e.g. "2026-11-06T12:34:56.000Z") */
  utcIso: string;
  /** Original raw string if provided as ISO string, otherwise canonical UTC ISO */
  sourceIso: string;
}

/**
 * Formatted timestamp ready for UI rendering.
 */
export interface FormattedTimestamp {
  /** YYYY/MM/DD HH:mm:ss in target timezone */
  dateTimeText: string;
  /** Short timezone name (e.g. "JST", "UTC", "GMT+9", "PST") */
  timeZoneShort: string;
  /** IANA timezone identifier (e.g. "Asia/Tokyo") */
  timeZoneId: string;
  /** Complete inline label (e.g. "🕒 2026/11/06 21:34:56 JST") */
  inlineText: string;
  /** Tooltip text containing local time, timezone, and original UTC ISO string */
  tooltipText: string;
  /** Canonical UTC ISO string */
  utcIso: string;
}

/**
 * Clip metadata extracted from Suno responses or DOM/React state.
 */
export interface ClipTimestampRecord {
  clipId: ClipId;
  /** Canonical UTC ISO-8601 timestamp */
  createdAtIso: string;
  /** Epoch ms when this record was stored in cache */
  fetchedAt: number;
}

/**
 * Message payload posted from MAIN world page-bridge to ISOLATED content script.
 */
export interface PageBridgeClipsMessage {
  source: 'suno-timestamp-extension-main';
  type: 'CLIPS_DISCOVERED';
  clips: Array<{
    id: string;
    createdAt: string | number;
  }>;
}

/**
 * Response posted from MAIN world page-bridge when probing a DOM element's React Fiber.
 */
export interface PageBridgeFiberProbeResponse {
  source: 'suno-timestamp-extension-main';
  type: 'FIBER_PROBE_RESULT';
  probeId: string;
  clipId: string | null;
  createdAt: string | number | null;
}
