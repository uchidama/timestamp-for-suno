import { ClipTimestampCache } from '../data/cache.js';
import { SunoTimestampProvider } from '../data/suno-provider.js';
import { SunoDomObserver } from './observer.js';
import { SunoTimestampUIController } from './ui.js';

const EXTENSION_BOOTSTRAPPED_FLAG = '__sunoTimestampContentBootstrapped_v1__';

export async function bootstrapSunoTimestampExtension(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const win = window as unknown as Record<string, unknown>;
  if (win[EXTENSION_BOOTSTRAPPED_FLAG]) {
    return;
  }
  win[EXTENSION_BOOTSTRAPPED_FLAG] = true;

  const cache = new ClipTimestampCache();
  const provider = new SunoTimestampProvider(cache);
  const uiController = new SunoTimestampUIController(provider);

  const observer = new SunoDomObserver(() => {
    provider.scanInitialPageScripts(document);
    return uiController.refresh(document);
  });

  // Whenever new clip timestamps arrive from network responses or storage hydration, refresh UI
  provider.onUpdate(() => {
    observer.scheduleRefresh();
  });

  // Hydrate persistent cache in parallel
  await cache.hydrate();

  const startOnBodyReady = (): void => {
    provider.scanInitialPageScripts(document);
    observer.start(document.body ?? document.documentElement);
    void uiController.refresh(document);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startOnBodyReady, {
      once: true,
    });
  } else {
    startOnBodyReady();
  }
}

// Auto-bootstrap when loaded as content script
void bootstrapSunoTimestampExtension();
