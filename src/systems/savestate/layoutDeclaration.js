/**
 * The *declared* savestate layout schema of this build, for build-identity composition (#238).
 *
 * This is NOT a layout registration: it carries no `validateSections`, and `layout.js` still
 * registers zero production layouts, so `inspectSnapshotEnvelope()` cannot admit a snapshot with
 * it. It exists because `buildId` must bind the layout schema (`savestateLayoutId`) and the
 * currently-shipped layout registry declares no sections. Every production schema addition MUST
 * extend this descriptor in the same change; because `buildId` hashes `savestateLayoutId`, any
 * change here produces a different build identity, which is the intended fail-closed behaviour.
 */
export const SAVESTATE_LAYOUT_DECLARATION_VERSION = 1;

export const SAVESTATE_LAYOUT_DESCRIPTOR = Object.freeze({
  version: SAVESTATE_LAYOUT_DECLARATION_VERSION,
  sections: Object.freeze({}),
});
