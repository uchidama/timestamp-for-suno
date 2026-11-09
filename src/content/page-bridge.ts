import { normalizeClipId } from './clip-id.js';
import { extractClipsFromJsonPayload } from '../data/suno-provider.js';
import { parseTimestamp } from '../shared/datetime.js';
import type {
  PageBridgeClipsMessage,
  PageBridgeFiberProbeResponse,
} from '../shared/types.js';

const BRIDGE_INSTALLED_FLAG = '__sunoTimestampBridgeInstalled_v1__';

interface FiberNode {
  memoizedProps?: unknown;
  pendingProps?: unknown;
  return?: FiberNode | null;
}

/**
 * Inspects a single React props object to see if it holds a single Clip `{ id, created_at }`.
 * Returns `null` if the props object represents a list of multiple clips.
 */
function extractSingleClipFromProps(
  props: unknown,
): { clipId: string; createdAt: string | number | null } | null {
  if (!props || typeof props !== 'object') {
    return null;
  }

  const record = props as Record<string, unknown>;

  // If this component holds an array of clips/items, stop so we never pick a list container
  if (
    Array.isArray(record.clips) ||
    Array.isArray(record.items) ||
    Array.isArray(record.songs) ||
    Array.isArray(record.project_clips)
  ) {
    return null;
  }

  // Check common single-clip prop keys used in React row/detail components
  const candidateObjects: unknown[] = [
    record.clip,
    record.song,
    record.track,
    record.item,
    record.currentClip,
    record.selectedClip,
    record.activeClip,
    record.data,
    record,
  ];

  for (const candidate of candidateObjects) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const obj = candidate as Record<string, unknown>;
    if (Array.isArray(obj.clips) || Array.isArray(obj.project_clips)) {
      continue;
    }

    // Require either a clip-specific property or an explicit `clip`/`song` wrapper key
    const hasClipShape =
      candidate !== record ||
      'created_at' in obj ||
      'audio_url' in obj ||
      'image_url' in obj ||
      'model_name' in obj ||
      'metadata' in obj;

    if (!hasClipShape) {
      continue;
    }

    const clipId = normalizeClipId(obj.id ?? obj.clip_id ?? obj.clipId);
    if (!clipId) {
      continue;
    }

    const rawCreated =
      obj.created_at ??
      obj.createdAt ??
      (obj.metadata && typeof obj.metadata === 'object' && obj.metadata !== null
        ? (obj.metadata as Record<string, unknown>).created_at
        : null);

    let validCreatedAt: string | number | null = null;
    if (typeof rawCreated === 'string' || typeof rawCreated === 'number') {
      const parsed = parseTimestamp(rawCreated);
      if (parsed) {
        validCreatedAt = parsed.utcIso;
      }
    }

    return { clipId, createdAt: validCreatedAt };
  }

  return null;
}

/**
 * Finds the React Fiber attached to a DOM element and walks up at most `maxAncestors` levels
 * to locate the single Clip associated with this specific row or detail panel.
 */
export function probeDomElementReactFiber(
  element: Element,
  maxAncestors = 10,
): { clipId: string; createdAt: string | number | null } | null {
  const keys = Object.keys(element);
  const fiberKey = keys.find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  );
  const propsKey = keys.find((k) => k.startsWith('__reactProps$'));

  const elRecord = element as unknown as Record<string, unknown>;

  if (propsKey && elRecord[propsKey]) {
    const directResult = extractSingleClipFromProps(elRecord[propsKey]);
    if (directResult) {
      return directResult;
    }
  }

  if (!fiberKey || !elRecord[fiberKey]) {
    return null;
  }

  let current: FiberNode | null | undefined = elRecord[fiberKey] as FiberNode;
  let depth = 0;

  while (current && depth <= maxAncestors) {
    const props = current.memoizedProps ?? current.pendingProps;
    if (props && typeof props === 'object') {
      const propRecord = props as Record<string, unknown>;
      // Stop climbing if we hit a parent component that renders a list of multiple items
      if (
        (Array.isArray(propRecord.clips) && propRecord.clips.length > 1) ||
        (Array.isArray(propRecord.items) && propRecord.items.length > 1) ||
        (Array.isArray(propRecord.songs) && propRecord.songs.length > 1)
      ) {
        break;
      }

      const found = extractSingleClipFromProps(props);
      if (found) {
        return found;
      }
    }
    current = current.return;
    depth++;
  }

  return null;
}

function postDiscoveredClips(
  clips: Array<{ id: string; createdAt: string | number }>,
): void {
  if (clips.length === 0 || typeof window === 'undefined') {
    return;
  }
  const message: PageBridgeClipsMessage = {
    source: 'suno-timestamp-extension-main',
    type: 'CLIPS_DISCOVERED',
    clips,
  };
  try {
    window.postMessage(message, window.location.origin);
  } catch {
    // Ignore postMessage errors
  }
}

function inspectJsonPayload(payload: unknown): void {
  try {
    const clips = extractClipsFromJsonPayload(payload);
    if (clips.length > 0) {
      postDiscoveredClips(clips);
    }
  } catch {
    // Never allow payload inspection to throw into page context
  }
}

/**
 * Installs passive hooks in the page's MAIN world.
 * Never reads or transmits tokens, cookies, prompts, lyrics, or audio data.
 */
export function installPageBridge(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const win = window as unknown as Record<string, unknown>;
  if (win[BRIDGE_INSTALLED_FLAG]) {
    return;
  }
  win[BRIDGE_INSTALLED_FLAG] = true;

  // 1. Passive fetch response observer
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const response = await originalFetch.apply(this, args);
      try {
        const contentType = response.headers?.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const cloned = response.clone();
          void cloned
            .json()
            .then((json) => {
              inspectJsonPayload(json);
            })
            .catch(() => {
              // Ignore non-JSON or aborted streams
            });
        }
      } catch {
        // Never interfere with page fetch
      }
      return response;
    };
  }

  // 2. Passive XMLHttpRequest response observer
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (
      ...args: Parameters<XMLHttpRequest['send']>
    ): void {
      try {
        this.addEventListener('load', function () {
          try {
            const contentType = this.getResponseHeader('content-type') ?? '';
            if (!contentType.includes('application/json')) {
              return;
            }
            if (
              (this.responseType === '' || this.responseType === 'text') &&
              typeof this.responseText === 'string' &&
              this.responseText.includes('created_at')
            ) {
              const parsed = JSON.parse(this.responseText) as unknown;
              inspectJsonPayload(parsed);
            } else if (
              this.responseType === 'json' &&
              this.response &&
              typeof this.response === 'object'
            ) {
              inspectJsonPayload(this.response);
            }
          } catch {
            // Ignore XHR inspection errors
          }
        });
      } catch {
        // Ignore listener attachment errors
      }
      return originalSend.apply(this, args);
    };
  }

  // 3. React Fiber probe listener
  window.addEventListener('suno-ts-probe-request', (event: Event) => {
    try {
      const customEvent = event as CustomEvent<{ probeId?: string }>;
      const probeId = customEvent.detail?.probeId;
      if (!probeId || typeof probeId !== 'string') {
        return;
      }

      const targetEl = document.querySelector(
        `[data-suno-ts-probe-id="${CSS.escape(probeId)}"]`,
      );
      let clipId: string | null = null;
      let createdAt: string | number | null = null;

      if (targetEl) {
        const result = probeDomElementReactFiber(targetEl);
        if (result) {
          clipId = result.clipId;
          createdAt = result.createdAt;
        }
      }

      const response: PageBridgeFiberProbeResponse = {
        source: 'suno-timestamp-extension-main',
        type: 'FIBER_PROBE_RESULT',
        probeId,
        clipId,
        createdAt,
      };
      window.postMessage(response, window.location.origin);
    } catch {
      // Ignore probe errors
    }
  });

  // 4. SPA History navigation notifier
  const notifyNavigation = (): void => {
    try {
      window.dispatchEvent(new CustomEvent('suno-ts-location-change'));
    } catch {
      // Ignore
    }
  };

  const originalPushState = history.pushState;
  history.pushState = function (
    ...args: Parameters<History['pushState']>
  ): void {
    const result = originalPushState.apply(this, args);
    notifyNavigation();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (
    ...args: Parameters<History['replaceState']>
  ): void {
    const result = originalReplaceState.apply(this, args);
    notifyNavigation();
    return result;
  };
}

// Auto-install when executed in browser context
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installPageBridge();
}
