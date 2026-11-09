import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractClipIdFromLocation,
  extractClipIdFromMediaUrl,
  extractClipIdFromUrl,
  normalizeClipId,
} from '../src/content/clip-id.js';
import { probeDomElementReactFiber } from '../src/content/page-bridge.js';
import { ClipTimestampCache } from '../src/data/cache.js';
import {
  extractClipsFromJsonPayload,
  extractClipsFromSerializedText,
  SunoTimestampProvider,
} from '../src/data/suno-provider.js';

const CLIP_A = '11111111-2222-4333-8444-555555555555';
const CLIP_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PROJECT_ID = '99999999-8888-4777-8666-555555555555';

describe('clip-id & SunoTimestampProvider', () => {
  it('normalizes valid UUIDs and rejects non-UUIDs', () => {
    assert.equal(
      normalizeClipId('11111111-2222-4333-8444-555555555555'),
      CLIP_A,
    );
    assert.equal(
      normalizeClipId('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'),
      CLIP_B,
    );
    assert.equal(normalizeClipId('not-a-uuid'), null);
    assert.equal(normalizeClipId(''), null);
    assert.equal(normalizeClipId(null), null);
  });

  it('extracts Clip ID from /song/<uuid> URLs while ignoring /playlist/ or /workspace/', () => {
    assert.equal(extractClipIdFromUrl(`/song/${CLIP_A}`), CLIP_A);
    assert.equal(
      extractClipIdFromUrl(`https://suno.com/song/${CLIP_B}?sh=xyz`),
      CLIP_B,
    );
    assert.equal(extractClipIdFromUrl(`/playlist/${CLIP_A}`), null);
    assert.equal(extractClipIdFromUrl(`/workspace/${CLIP_A}`), null);
    assert.equal(
      extractClipIdFromLocation(`/song/${CLIP_A}`, ''),
      CLIP_A,
    );
  });

  it('extracts Clip ID from media URLs only when matching known clip IDs if provided', () => {
    const known = new Set([CLIP_A]);
    assert.equal(
      extractClipIdFromMediaUrl(
        `https://cdn2.suno.ai/image_${CLIP_A}.jpeg`,
        known,
      ),
      CLIP_A,
    );
    assert.equal(
      extractClipIdFromMediaUrl(
        `https://cdn2.suno.ai/image_${CLIP_B}.jpeg`,
        known,
      ),
      null,
    );
  });

  it('distinguishes same-title songs strictly by Clip ID in payload extraction & cache', () => {
    const mockFeedResponse = {
      id: PROJECT_ID,
      name: 'My Workspace',
      created_at: '2026-11-01T00:00:00Z',
      project_clips: [
        {
          clip: {
            id: CLIP_A,
            title: '吉野ヶ里 ― 邪馬台国はここにあったのか？',
            created_at: '2026-11-06T12:34:56Z',
          },
        },
        {
          clip: {
            id: CLIP_B,
            title: '吉野ヶ里 ― 邪馬台国はここにあったのか？',
            created_at: '2026-11-06T12:35:02Z',
          },
        },
      ],
    };

    const extracted = extractClipsFromJsonPayload(mockFeedResponse);
    // Project container ID must be excluded because it owns `project_clips`,
    // while both same-title clips must be extracted with their distinct timestamps!
    assert.equal(extracted.length, 2);

    const cache = new ClipTimestampCache();
    const provider = new SunoTimestampProvider(cache, {
      enableFallbackFetch: false,
    });
    provider.ingestClips(extracted);

    assert.equal(provider.getCachedTimestamp(PROJECT_ID), null);
    assert.equal(
      provider.getCachedTimestamp(CLIP_A),
      '2026-11-06T12:34:56.000Z',
    );
    assert.equal(
      provider.getCachedTimestamp(CLIP_B),
      '2026-11-06T12:35:02.000Z',
    );
  });

  it('extracts clips from Next.js serialized Flight text payloads', () => {
    const flightText = `self.__next_f.push([1,"{\\"clips\\":[{\\"id\\":\\"${CLIP_A}\\",\\"title\\":\\"Song\\",\\"created_at\\":\\"2026-11-06T12:34:56.000Z\\"}]}"])`;
    const found = extractClipsFromSerializedText(flightText);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, CLIP_A);
    assert.equal(found[0].createdAt, '2026-11-06T12:34:56.000Z');
  });

  it('probes React Fiber props on a DOM node to resolve clipId and created_at', () => {
    const fakeDomElement = {
      __reactFiber$xyz123: {
        memoizedProps: { className: 'row-inner' },
        return: {
          memoizedProps: {
            clip: {
              id: CLIP_B,
              title: '吉野ヶ里 ― 邪馬台国はここにあったのか？',
              created_at: '2026-11-06T12:35:02Z',
            },
          },
          return: {
            memoizedProps: {
              clips: [{ id: CLIP_A }, { id: CLIP_B }],
            },
          },
        },
      },
    } as unknown as Element;

    const probed = probeDomElementReactFiber(fakeDomElement);
    assert.ok(probed);
    assert.equal(probed.clipId, CLIP_B);
    assert.equal(probed.createdAt, '2026-11-06T12:35:02.000Z');
  });
});
