import type { LiveProfileProjection } from "./profileContentIntegrity";

/**
 * The Profile route is the owner of the live form/editor projection.  Keep
 * this registry process-local: it is a diagnostic observation, not another
 * persistence surface and never contains the underlying text.
 */
const projections = new Map<string, LiveProfileProjection>();
const itemHistory = new Map<string, { seen: boolean; mismatch: boolean }>();

export function publishLiveProfileProjection(input: LiveProfileProjection) {
  const itemKey = `${input.profileId}:${input.profileRevision}:${input.selectedItemId ?? "none"}`;
  const previous = itemHistory.get(itemKey) ?? { seen: false, mismatch: false };
  const mismatch = !input.dirty && (
    input.adapter.bulletCount !== input.form.bulletCount
    || input.adapter.paragraphCount !== input.form.paragraphCount
    || input.form.bulletCount !== input.editor.visibleBulletCount
    || input.form.paragraphCount !== input.editor.visibleParagraphCount
  );
  itemHistory.set(itemKey, {
    seen: true,
    mismatch: previous.mismatch || mismatch
  });
  projections.set(input.profileId, {
    ...input,
    rehydrationIssue: !input.dirty && mismatch && previous.seen
  });
}

export function getLiveProfileProjection(profileId: string, profileRevision: number) {
  const projection = projections.get(profileId);
  if (!projection || projection.profileRevision !== profileRevision) return undefined;
  return projection;
}

export function clearLiveProfileProjection(profileId: string) {
  projections.delete(profileId);
}
