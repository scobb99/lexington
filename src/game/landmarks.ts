// (v3.0) Landmarks (Build Spec v3.0, Section 21; LOCKED amendment ruling 1). Pure rules.

import { LANDMARK_NAMES, TIER_ORDER } from './buildings';
import type { BuildingType, LandmarkId } from './types';

export const LANDMARK_ORDER: LandmarkId[] = ['fountain', 'marketCross', 'lanternPost', 'oakArch', 'riverBell', 'foundersSpire'];

/** Section 21 milestones 1 to 4: buildings ever built. */
export const BUILDING_MILESTONES: [LandmarkId, number][] = [
  ['fountain', 5],
  ['marketCross', 10],
  ['lanternPost', 15],
  ['oakArch', 25],
];
/** Section 21 milestone 5: the first bridge path of 8 or more tiles. */
export const RIVER_BELL_TILES = 8;

/**
 * Buildings ever built, read from the lifetime record (the Section 9 "built" family). Only bought
 * buildings count: the town center is founded and landmarks are earned, so neither counts.
 */
export function buildingsEverBuilt(everBuilt: Partial<Record<BuildingType, number>>): number {
  return TIER_ORDER.reduce((n, t) => n + (everBuilt[t] ?? 0), 0);
}

/** Landmarks the lifetime record has earned (River Bell is earned by its own event and kept). */
export function landmarksEarnedBy(everBuilt: Partial<Record<BuildingType, number>>, riverBell: boolean): LandmarkId[] {
  const n = buildingsEverBuilt(everBuilt);
  const out: LandmarkId[] = BUILDING_MILESTONES.filter(([, need]) => n >= need).map(([id]) => id);
  if (riverBell) out.push('riverBell');
  if ((everBuilt.townHall ?? 0) >= 1) out.push('foundersSpire');
  return LANDMARK_ORDER.filter((id) => out.includes(id));
}

/** Section 21: the message when a landmark is earned. */
export function earnedLine(id: LandmarkId): string {
  return `Your town has earned a landmark: ${LANDMARK_NAMES[id]}. Place it from the build panel.`;
}

/** Section 21 (proposed wording). */
export const LANDMARK_STAYS = "Landmarks stay. They are the town's memory.";
export function landmarkFreeLine(id: LandmarkId): string {
  return `${LANDMARK_NAMES[id]}: free. It is earned, not bought.`;
}
