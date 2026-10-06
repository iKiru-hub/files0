/** Preferred edge-to-edge clearance; node dimensions and relationships still matter. */
export const DEFAULT_NOTE_SPACING = 48;
export const MIN_NOTE_SPACING = 16;
export const MAX_NOTE_SPACING = 200;
export function normalizeSpacing(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(MIN_NOTE_SPACING, Math.min(MAX_NOTE_SPACING, value)) / 4) * 4 : DEFAULT_NOTE_SPACING;
}
