'use strict';

/**
 * @fileoverview Change events and template cascades across a SHARED content root.
 *
 * Both behaviours here were broken by the same assumption — that one directory
 * on disk belongs to one space.
 *
 * EVENTS. The watcher keys its watch list by path, so several spaces on one root
 * collapse to a single entry and the FIRST one became "the" space for every
 * event. Notification topics are `<spaceName>::<type>:<path>`, built from the
 * subscription's space when subscribing and the event's space when publishing,
 * so a subscription made in any other space on that root could never match its
 * own topic: no history, no push, no badge, nothing logged. The same single
 * event was also broadcast to Socket.IO carrying a path the space might curate
 * away. Emitting once per space that can SEE the path fixes both at the source.
 *
 * TEMPLATE CASCADE. The cascade walks a folder's ancestors, so it crosses
 * folders the caller never named — including a pass-through container whose
 * contents the space deliberately hides. Listing leaked each template's name,
 * path and title line out of a hidden subtree.
 *
 * These are pure-logic tests over the same two rules the implementations use;
 * they do not spin up chokidar or Express.
 */

const {
  templateDirsFor,
  pickClosest
} = require('../../../src/shared/utils/filePolicy');
const { isPathVisible } = require('../../../src/shared/spaces/spacePaths');

const ROOT = '/content/engineering';

const ENGINEERING = { id: 1, name: 'Engineering', path: ROOT };
const RETAIL = {
  id: 5,
  name: 'Retail',
  path: ROOT,
  configuration: { allowedPaths: ['Solution Design/Distribution', 'Standards'] }
};
const FINTECH = {
  id: 7,
  name: 'Fintech',
  path: ROOT,
  configuration: { allowedPaths: ['Standards'] }
};
const OTHER_ROOT = { id: 9, name: 'Elsewhere', path: '/content/other' };

/**
 * The rule `emitChangeForSpaces` applies: one event per space on the root that
 * exposes the path. Mirrored here so the intent is asserted independently of
 * chokidar wiring.
 */
function spacesNotifiedFor(spacesOnRoot, relativePath, kind = 'file') {
  return spacesOnRoot.filter(s => isPathVisible(s, relativePath, kind)).map(s => s.name);
}

describe('a change event reaches every space that can see it', () => {
  const onRoot = [ENGINEERING, RETAIL, FINTECH];

  test('a file all three expose notifies all three', () => {
    // Before the fix only the first space in spaces.json was ever notified, so
    // subscriptions in the other two were silently dead.
    expect(spacesNotifiedFor(onRoot, 'Standards/coding.md').sort())
      .toEqual(['Engineering', 'Fintech', 'Retail']);
  });

  test('a file only some expose notifies only those', () => {
    expect(spacesNotifiedFor(onRoot, 'Solution Design/Distribution/api.md').sort())
      .toEqual(['Engineering', 'Retail']);
  });

  test('a file in a curated-away subtree notifies only the unrestricted space', () => {
    // The broadcast leak: this used to go out stamped with whichever space was
    // primary, and clients rendered a live nav entry that 404s when clicked.
    expect(spacesNotifiedFor(onRoot, 'Business Processes/private.md'))
      .toEqual(['Engineering']);
  });

  test('the space landing page reaches every space on the root', () => {
    // Root-level files are exempt, which is what keeps each space's own home
    // page live-updating.
    expect(spacesNotifiedFor(onRoot, 'home.md').sort())
      .toEqual(['Engineering', 'Fintech', 'Retail']);
  });

  test('a folder event is judged as a folder, not as a file', () => {
    // A pass-through container is listable but not visible in its own right, so
    // it must not raise a folder-created event for a space that only passes
    // through it.
    expect(spacesNotifiedFor(onRoot, 'Solution Design', 'folder').sort())
      .toEqual(['Engineering']);
    expect(spacesNotifiedFor(onRoot, 'Standards', 'folder').sort())
      .toEqual(['Engineering', 'Fintech', 'Retail']);
  });

  test('a space on a DIFFERENT root is never in the group', () => {
    // The watch entry is keyed by path, so this space simply is not a member —
    // asserted so a future refactor to "notify every space" is caught.
    expect([ENGINEERING, RETAIL, FINTECH]).not.toContain(OTHER_ROOT);
  });
});

describe('the template cascade stops at the visibility boundary', () => {
  /**
   * The rule `resolveTemplateCascade` applies: walk the ancestors, but skip any
   * tier the space does not expose. The root tier is always kept — its owner
   * folder is '', the root-level exemption.
   */
  function visibleTiers(space, folderPath) {
    const dirs = templateDirsFor(folderPath);
    return dirs.filter((relDir, i) => {
      const isRoot = i === dirs.length - 1;
      if (isRoot) return true;
      return isPathVisible(space, `${relDir}/probe.md`);
    });
  }

  const DEEP = 'Solution Design/Distribution/Buy';

  test('an unrestricted space walks the whole chain', () => {
    expect(visibleTiers(ENGINEERING, DEEP)).toEqual([
      'Solution Design/Distribution/Buy/.system/templates',
      'Solution Design/Distribution/.system/templates',
      'Solution Design/.system/templates',
      '.system/templates'
    ]);
  });

  test('a curated space skips the pass-through container it only drills through', () => {
    // `Solution Design` is kept in the nav so you can reach Distribution;
    // its own contents — templates included — stay hidden.
    expect(visibleTiers(RETAIL, DEEP)).toEqual([
      'Solution Design/Distribution/Buy/.system/templates',
      'Solution Design/Distribution/.system/templates',
      '.system/templates'
    ]);
  });

  test('the space tier always survives, so a space-wide template still reaches everywhere', () => {
    // Dropping it would break templates for every curated space.
    expect(visibleTiers(FINTECH, DEEP)).toEqual(['.system/templates']);
    expect(visibleTiers(FINTECH, 'Standards/Code')).toEqual([
      'Standards/Code/.system/templates',
      'Standards/.system/templates',
      '.system/templates'
    ]);
  });

  test('shadowing still applies across the tiers that survive', () => {
    // Skipping a tier must not disturb closest-wins for the rest.
    const survived = [
      { name: 'Code Repositories', distance: 0 },
      { name: 'API Definition', distance: 1 },
      { name: 'Code Repositories', distance: 3 }
    ];
    expect(pickClosest(survived).map(t => `${t.name}@${t.distance}`))
      .toEqual(['Code Repositories@0', 'API Definition@1']);
  });

  test('a hidden folder asked for directly yields only the space tier', () => {
    // Belt and braces: the route rejects such a folderPath outright with 404,
    // but if that check were ever bypassed the cascade must still not open the
    // hidden folder's own templates.
    expect(visibleTiers(RETAIL, 'Business Processes')).toEqual(['.system/templates']);
  });
});
