import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyTimestampToTarget,
  BADGE_ATTR,
  BADGE_CLIP_ID_ATTR,
  BADGE_UTC_ATTR,
  createOrUpdateBadgeElement,
  type TargetDescriptor,
} from '../src/content/ui.js';

const CLIP_1 = '11111111-2222-4333-8444-555555555555';
const CLIP_2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/**
 * Minimal lightweight DOM mock to verify UI badge injection, idempotency,
 * detail-panel song switching, and stale-badge removal without external browser dependencies.
 */
class MockElement {
  public tagName: string;
  public id = '';
  public textContent = '';
  public parentNode: MockElement | null = null;
  public children: MockElement[] = [];
  private attrs = new Map<string, string>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  public get nextSibling(): MockElement | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentNode.children.length
      ? this.parentNode.children[idx + 1]
      : null;
  }

  public setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  public hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  public appendChild(child: MockElement): MockElement {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public insertBefore(
    newNode: MockElement,
    refNode: MockElement | null,
  ): MockElement {
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }
    newNode.parentNode = this;
    if (!refNode) {
      this.children.push(newNode);
      return newNode;
    }
    const idx = this.children.indexOf(refNode);
    if (idx === -1) {
      this.children.push(newNode);
    } else {
      this.children.splice(idx, 0, newNode);
    }
    return newNode;
  }

  public removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const attrMatch = /^\[([a-z0-9-]+)\]$/i.exec(selector.trim());
    const attrName = attrMatch ? attrMatch[1] : null;

    const walk = (node: MockElement): void => {
      for (const child of node.children) {
        if (attrName && child.hasAttribute(attrName)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  public querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all[0] ?? null;
  }
}

class MockDocument {
  public head = new MockElement('head');
  public createElement(tag: string): MockElement {
    return new MockElement(tag);
  }
  public getElementById(id: string): MockElement | null {
    return this.head.children.find((c) => c.id === id) ?? null;
  }
}

describe('ui — badge creation, idempotency, and detail panel switching', () => {
  it('creates badge with safe textContent and updates in-place when song changes', () => {
    const mockDoc = new MockDocument() as unknown as Document;
    const container = new MockElement('div') as unknown as Element;
    const mountPoint = new MockElement('div') as unknown as Element;
    container.appendChild(mountPoint);

    const target1: TargetDescriptor = {
      kind: 'detail',
      container,
      mountPoint,
      mountPosition: 'append',
      clipId: CLIP_1,
    };

    // 1. Render Song 1 in Detail Panel
    const badge1 = applyTimestampToTarget(
      target1,
      '2026-11-06T12:34:56Z',
      { doc: mockDoc, timeZone: 'Asia/Tokyo' },
    );
    assert.ok(badge1);
    assert.equal(badge1.textContent, '🕒 2026/11/06 21:34:56 JST');
    assert.equal(badge1.getAttribute(BADGE_CLIP_ID_ATTR), CLIP_1);
    assert.equal(
      badge1.getAttribute(BADGE_UTC_ATTR),
      '2026-11-06T12:34:56.000Z',
    );
    assert.equal(container.querySelectorAll(`[${BADGE_ATTR}]`).length, 1);

    // 2. Re-applying same song is idempotent (still 1 badge)
    applyTimestampToTarget(target1, '2026-11-06T12:34:56Z', {
      doc: mockDoc,
      timeZone: 'Asia/Tokyo',
    });
    assert.equal(container.querySelectorAll(`[${BADGE_ATTR}]`).length, 1);

    // 3. Switching Detail Panel to Song 2 updates the existing badge to Song 2's timestamp
    const target2: TargetDescriptor = {
      ...target1,
      clipId: CLIP_2,
    };
    const badge2 = applyTimestampToTarget(
      target2,
      '2026-11-06T14:00:00Z',
      { doc: mockDoc, timeZone: 'Asia/Tokyo' },
    );
    assert.ok(badge2);
    assert.equal(badge2.textContent, '🕒 2026/11/06 23:00:00 JST');
    assert.equal(badge2.getAttribute(BADGE_CLIP_ID_ATTR), CLIP_2);
    assert.equal(container.querySelectorAll(`[${BADGE_ATTR}]`).length, 1);

    // 4. Switching Detail Panel to a song whose timestamp is unknown (null) removes the badge
    // so the previous song's timestamp is never mistakenly displayed!
    const badgeRemoved = applyTimestampToTarget(target2, null, {
      doc: mockDoc,
      timeZone: 'Asia/Tokyo',
    });
    assert.equal(badgeRemoved, null);
    assert.equal(container.querySelectorAll(`[${BADGE_ATTR}]`).length, 0);
  });

  it('returns null and cleans up existing badge if invalid timestamp is supplied', () => {
    const mockDoc = new MockDocument() as unknown as Document;
    const badge = createOrUpdateBadgeElement(
      mockDoc,
      null,
      'row',
      CLIP_1,
      'invalid-timestamp',
      'Asia/Tokyo',
    );
    assert.equal(badge, null);
  });
});
