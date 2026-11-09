import type { FormattedTimestamp, ParsedTimestamp, RawTimestampInput } from './types.js';

/** Minimum plausible timestamp: 2020-01-01T00:00:00.000Z */
const MIN_VALID_UNIX_SEC = 1_577_836_800;
/** Maximum plausible timestamp: 2100-01-01T00:00:00.000Z */
const MAX_VALID_UNIX_SEC = 4_102_444_800;

const MIN_VALID_UNIX_MS = MIN_VALID_UNIX_SEC * 1000;
const MAX_VALID_UNIX_MS = MAX_VALID_UNIX_SEC * 1000;

/**
 * Strict ISO-8601 regex requiring explicit date, time, and timezone offset (Z or ±HH:MM / ±HHMM).
 * Groups:
 * 1: YYYY, 2: MM, 3: DD, 4: HH, 5: mm, 6: ss, 7: fractional seconds (optional), 8: TZ
 */
const STRICT_ISO_8601_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|([+-])(\d{2}):?(\d{2}))$/;

/**
 * Pure numeric string pattern (integer or decimal).
 */
const NUMERIC_STRING_REGEX = /^\d+(?:\.\d+)?$/;

/**
 * Well-known IANA timeZone -> abbreviation fallback table when Intl returns "GMT+X".
 */
const KNOWN_TZ_ABBREVIATIONS: Record<string, string> = {
  'Asia/Tokyo': 'JST',
  'Etc/UTC': 'UTC',
  UTC: 'UTC',
  'Etc/GMT': 'GMT',
};

/**
 * Checks whether a given year is a leap year in the Gregorian calendar.
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the number of days in a given month (1-12) of a year.
 */
function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Converts a numeric Unix timestamp (either seconds or milliseconds) to epoch milliseconds.
 * Returns null if the unit is uncertain or the value falls outside [2020-01-01, 2100-01-01].
 */
function parseNumericTimestampToMs(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  // Check if value is within the plausible Unix seconds range [1.577e9, 4.102e9]
  if (value >= MIN_VALID_UNIX_SEC && value <= MAX_VALID_UNIX_SEC) {
    return Math.round(value * 1000);
  }

  // Check if value is within the plausible Unix milliseconds range [1.577e12, 4.102e12]
  // Millisecond timestamps must be integers (no fractional milliseconds)
  if (
    value >= MIN_VALID_UNIX_MS &&
    value <= MAX_VALID_UNIX_MS &&
    Number.isInteger(value)
  ) {
    return value;
  }

  // Ambiguous unit (e.g. 11-12 digits, microseconds, or out of plausible range)
  return null;
}

/**
 * Safely parses a raw `created_at` value (ISO 8601 string, Unix seconds, or Unix milliseconds).
 * Returns `null` if the input is invalid, missing a timezone, or has an uncertain unit.
 */
export function parseTimestamp(input: unknown): ParsedTimestamp | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === 'number') {
    const epochMs = parseNumericTimestampToMs(input);
    if (epochMs === null) {
      return null;
    }
    const utcIso = new Date(epochMs).toISOString();
    return {
      epochMs,
      utcIso,
      sourceIso: utcIso,
    };
  }

  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Handle pure numeric strings only if they unambiguously match Unix seconds or milliseconds
  if (NUMERIC_STRING_REGEX.test(trimmed)) {
    const numValue = Number(trimmed);
    const epochMs = parseNumericTimestampToMs(numValue);
    if (epochMs === null) {
      return null;
    }
    const utcIso = new Date(epochMs).toISOString();
    return {
      epochMs,
      utcIso,
      sourceIso: utcIso,
    };
  }

  const match = STRICT_ISO_8601_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionRaw = match[7] ?? '';
  const tzPart = match[8];
  const tzSign = match[9];
  const tzHour = match[10] !== undefined ? Number(match[10]) : 0;
  const tzMinute = match[11] !== undefined ? Number(match[11]) : 0;

  // Validate calendar boundaries explicitly to avoid Date.UTC / Date.parse rollover bugs
  if (month < 1 || month > 12) return null;
  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;
  if (tzHour > 23 || tzMinute > 59) return null;

  // Convert fractional seconds (up to 9 digits) to milliseconds (3 digits)
  const msFraction =
    fractionRaw.length > 0
      ? Math.floor(Number(fractionRaw.padEnd(3, '0').slice(0, 3)))
      : 0;

  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, msFraction);
  if (!Number.isFinite(baseUtcMs)) {
    return null;
  }

  let offsetMs = 0;
  if (tzPart !== 'Z' && tzPart !== 'z') {
    const totalOffsetMinutes = tzHour * 60 + tzMinute;
    offsetMs = (tzSign === '+' ? 1 : -1) * totalOffsetMinutes * 60 * 1000;
  }

  const epochMs = baseUtcMs - offsetMs;
  if (epochMs < MIN_VALID_UNIX_MS || epochMs > MAX_VALID_UNIX_MS) {
    return null;
  }

  const utcIso = new Date(epochMs).toISOString();
  return {
    epochMs,
    utcIso,
    sourceIso: trimmed,
  };
}

export interface FormatTimestampOptions {
  /**
   * Optional IANA timeZone override (defaults to the browser's local timezone).
   */
  timeZone?: string;
  /**
   * Whether to prepend the clock icon (`🕒 `) in `inlineText`. Defaults to `true`.
   */
  includeIcon?: boolean;
  /**
   * Whether to append the short timezone abbreviation (e.g. ` JST`) in `inlineText`. Defaults to `true`.
   */
  includeTimeZoneShort?: boolean;
}

/**
 * Resolves the active IANA timezone string safely.
 */
export function resolveLocalTimeZone(overrideTimeZone?: string): string {
  if (overrideTimeZone && overrideTimeZone.trim().length > 0) {
    return overrideTimeZone.trim();
  }
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // Ignore Intl errors and fall back to UTC
  }
  return 'UTC';
}

/**
 * Resolves a human-friendly short timezone abbreviation (e.g. "JST", "UTC", "PST", "GMT+9").
 */
export function getShortTimeZoneName(date: Date, timeZone: string): string {
  if (KNOWN_TZ_ABBREVIATIONS[timeZone]) {
    return KNOWN_TZ_ABBREVIATIONS[timeZone];
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzPart && tzPart.length > 0) {
      return tzPart;
    }
  } catch {
    // Fall through
  }
  return timeZone;
}

/**
 * Formats a parsed or raw timestamp into `YYYY/MM/DD HH:mm:ss` in the target timezone,
 * along with inline badge text and tooltip metadata.
 * Returns `null` if the input cannot be safely parsed.
 */
export function formatTimestamp(
  input: ParsedTimestamp | RawTimestampInput,
  options: FormatTimestampOptions = {},
): FormattedTimestamp | null {
  const parsed: ParsedTimestamp | null =
    input !== null &&
    typeof input === 'object' &&
    'epochMs' in input &&
    typeof input.epochMs === 'number'
      ? input
      : parseTimestamp(input);

  if (!parsed) {
    return null;
  }

  const timeZoneId = resolveLocalTimeZone(options.timeZone);
  const date = new Date(parsed.epochMs);

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    // If an invalid timeZone override was supplied, return null rather than wrong data
    return null;
  }

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }

  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  // Normalize "24" if any engine emits 24 for midnight
  const rawHour = partMap.hour;
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = partMap.minute;
  const second = partMap.second;

  if (!year || !month || !day || !hour || !minute || !second) {
    return null;
  }

  const dateTimeText = `${year}/${month}/${day} ${hour}:${minute}:${second}`;
  const timeZoneShort = getShortTimeZoneName(date, timeZoneId);

  const includeIcon = options.includeIcon ?? true;
  const includeTz = options.includeTimeZoneShort ?? true;

  const prefix = includeIcon ? '🕒 ' : '';
  const suffix = includeTz && timeZoneShort ? ` ${timeZoneShort}` : '';
  const inlineText = `${prefix}${dateTimeText}${suffix}`;

  const tooltipText = `Created: ${dateTimeText} (${timeZoneId} / ${timeZoneShort})\nUTC: ${parsed.utcIso}`;

  return {
    dateTimeText,
    timeZoneShort,
    timeZoneId,
    inlineText,
    tooltipText,
    utcIso: parsed.utcIso,
  };
}
