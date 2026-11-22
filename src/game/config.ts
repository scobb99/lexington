// The game's name (Build Spec v2.0, NAME token; amendment of Nov 22, 2026: Stu picked
// "Lexington"). Everywhere the game shows its own name (title screen, messages, exported save
// file names, page title) reads this one constant, so a rename is a one-line change here.
export const NAME = 'Lexington';

/** Lower-case form for file names, e.g. lexington-town-2026-11-22.json */
export const NAME_SLUG = NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
