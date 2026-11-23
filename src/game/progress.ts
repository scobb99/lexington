// Tiers and quests (Build Spec v3.0, Section 9; the quest chain is re-pointed in v3.0). Pure rules: no React, no Pixi, no store.
//
// Tiers unlock when every requirement is met and never relock. Quests are optional,
// permanent and never expire; completing one pays a fixed reward and reveals the next.
//
// Section 9 interpretation rulings (Stu, Nov 20, 2026):
// - "built" means ever built, for tier requirements and quests alike: removing a building
//   never unmeets a requirement;
// - progress made before a quest is revealed counts, and a quest already satisfied when it is
//   revealed completes and pays at once;
// - lifetime Knowledge includes Knowledge paid as quest rewards;
// - happiness 60 for Tier 3 is checked only at the moment of unlock.

import type { BuildingType, Resources, Tier } from './types';

export interface ProgressInputs {
  /** Section 8: 3 per Cottage (real buildings only). */
  population: number;
  /** Section 8: current happiness, 0 to 100. */
  happiness: number;
  /** Lifetime Knowledge earned from every source (words, production, quest rewards). */
  knowledgeEarned: number;
  /** Buildings ever built, by type (lifetime; removal does not lower it). */
  everBuilt: Partial<Record<BuildingType, number>>;
  /** Bridge tiles ever built (lifetime). */
  bridgesBuilt: number;
  /** Valid words submitted (lifetime). */
  validWords: number;
  /** Valid words of 7 letters or more (lifetime). */
  longWords: number;
  /** (v3.0) Commission orders completed (lifetime). */
  ordersCompleted: number;
  /** (v3.0) Valid words played through a stamped tile (lifetime). */
  stampedWords: number;
}

export interface Requirement {
  label: string;
  have: number;
  need: number;
  met: boolean;
}

const req = (label: string, have: number, need: number): Requirement => ({ label, have, need, met: have >= need });

/** Section 9: the requirements for reaching `tier`. */
export function tierRequirements(tier: 2 | 3, p: ProgressInputs): Requirement[] {
  // Section 9 ruling (v1.8): "built" means ever built, the same as the quest checks.
  const has = (t: BuildingType) => p.everBuilt[t] ?? 0;
  if (tier === 2) {
    return [
      req('Population', p.population, 15),
      req('Lifetime Knowledge earned', p.knowledgeEarned, 25),
      req('Sawmill built', Math.min(1, has('sawmill')), 1),
      req('Quarry built', Math.min(1, has('quarry')), 1),
    ];
  }
  return [
    req('Population', p.population, 40),
    req('Lifetime Knowledge earned', p.knowledgeEarned, 100),
    req('Market built', Math.min(1, has('market')), 1),
    req('Library built', Math.min(1, has('library')), 1),
    req('Pier built', Math.min(1, has('pier')), 1),
    req('Happiness', p.happiness, 60),
  ];
}

/**
 * Section 9: the tier the town should be at now. Tiers only go up ("once unlocked, a tier
 * never relocks"), and Tier 3 needs Tier 2 first. Happiness is checked only at the moment of
 * unlock: once Tier 3 is reached, later happiness changes cannot remove it.
 */
export function tierAfterCheck(current: Tier, p: ProgressInputs): Tier {
  let tier = current;
  if (tier === 1 && tierRequirements(2, p).every((r) => r.met)) tier = 2;
  if (tier === 2 && tierRequirements(3, p).every((r) => r.met)) tier = 3;
  return tier;
}

export const TIER_UNLOCKS: Record<2 | 3, string> = {
  2: 'Market, Library, Pier and Scribe are now available. Words now need at least 4 letters.',
  3: 'Town Hall, Park, Greenhouse, Tavern and Wizard Tower are now available.',
};

const reward = (r: Partial<Resources>): Resources => ({
  coins: r.coins ?? 0,
  lumber: r.lumber ?? 0,
  stone: r.stone ?? 0,
  knowledge: r.knowledge ?? 0,
  magic: r.magic ?? 0,
});

export interface Quest {
  title: string;
  goal: string;
  reward: Resources;
  progress: (p: ProgressInputs) => Requirement[];
}

/**
 * Section 9 (v3.0): the re-pointed quest chain, in order. Under material separation quest rewards
 * pay only Coins, Knowledge and Magic (First Home and Working Town moved to Coins, proposed);
 * First Commission and Stamped are new (proposed) and replace Place of Learning and Long Word.
 */
export const QUESTS: Quest[] = [
  {
    title: 'First Words',
    goal: 'Submit 3 valid words.',
    reward: reward({ coins: 10 }),
    progress: (p) => [req('Valid words', p.validWords, 3)],
  },
  {
    title: 'First Home',
    goal: 'Build a Cottage.',
    reward: reward({ coins: 10 }),
    progress: (p) => [req('Cottages built', p.everBuilt.cottage ?? 0, 1)],
  },
  {
    title: 'Cross the River',
    goal: 'Build a bridge tile.',
    reward: reward({ coins: 15 }),
    progress: (p) => [req('Bridge tiles built', p.bridgesBuilt, 1)],
  },
  {
    title: 'Working Town',
    goal: 'Build a Sawmill and a Quarry.',
    reward: reward({ coins: 15 }),
    progress: (p) => [req('Sawmill built', Math.min(1, p.everBuilt.sawmill ?? 0), 1), req('Quarry built', Math.min(1, p.everBuilt.quarry ?? 0), 1)],
  },
  {
    title: 'A Growing Town',
    goal: 'Reach a population of 15.',
    reward: reward({ coins: 20 }),
    progress: (p) => [req('Population', p.population, 15)],
  },
  {
    title: 'First Commission',
    goal: 'Complete 3 Commission orders at the town center.',
    reward: reward({ coins: 15 }),
    progress: (p) => [req('Commissions completed', p.ordersCompleted, 3)],
  },
  {
    title: 'Stamped',
    goal: 'Submit a valid word that uses a stamped tile.',
    reward: reward({ knowledge: 10 }),
    progress: (p) => [req('Words through a stamped tile', p.stampedWords, 1)],
  },
  {
    title: 'Town Hall',
    goal: 'Build the Town Hall.',
    reward: reward({ coins: 50 }),
    progress: (p) => [req('Town Hall built', Math.min(1, p.everBuilt.townHall ?? 0), 1)],
  },
];

/** Section 9: the closing messages after the last quest. */
export const CHAIN_COMPLETE = 'Every quest is complete. Congratulations on your town!';
export const FREE_PLAY = 'Your town is complete, and it can keep growing: build, play words, and enjoy it at your own pace.';

export function questDone(index: number, p: ProgressInputs): boolean {
  const q = QUESTS[index];
  return !!q && q.progress(p).every((r) => r.met);
}
