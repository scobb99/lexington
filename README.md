# Lexington

A cozy, word-driven city builder. Built to **Build Spec v2.0** (with the amendment naming the game Lexington).

**Status: v2.0 is built.** New in v2.0:

- **Title screen** with Continue, New Town, How to Play and Saves.
- **How to Play:** a two-minute guided first town (11 steps, on the fixed map "hearth"). It never touches your saved town.
- **Roads and bridges are previewed first.** You draw, see the total, then tap **Confirm**. Nothing is charged while drawing.
- **Building ghost:** a see-through building shows where it will go. Green means it can go there; red says why not. Nothing is charged until **Confirm**.
- **Build cards** say what each building costs, what it does, and where it can go.
- **One way to spell:** tap letter tiles (or type on a computer keyboard). The word box is never a text box, so a phone keyboard never pops up.
- **Word tools:**
  - a **delete** key: tap to remove the last letter, hold to clear the word;
  - **Hint:** free, three steps from length to the full word;
  - **Swap:** 2 Coins a tile.
- **Changing the land:**
  - **Clear** thicket for 6 Coins and 3 Lumber a tile.
  - **Drain** marsh into meadow from Tier 2, for 5 Coins and 2 Lumber a tile.
  - Marsh now needs a **bridge** to cross.
- **New economy:** production buildings pay more and carry the town (Section 6).
- **Prettier ground:**
  - softer edges where land meets water and marsh;
  - forests read as one canopy;
  - big hills get a peak;
  - buildings sit on soft shadows.
- **Gemini art** for the game icon, the letter tiles, the resource icons, and the river (four water styles).

## How to play (controls)

### Starting

- **Continue:** back to your town, just as you left it. It only shows when there is a saved town.
- **New Town:** a fresh map. If you already have a saved town, type **NEW** to confirm, because the autosave is replaced. Your three save slots are kept. You can type a map seed, or leave it empty for a surprise map.
- **How to Play:** the tutorial. You can **Skip tutorial** at any step.
- **Saves:** load a slot, export a slot to a file, or import a town file.

### On a computer

- **Look around:** drag the map, or scroll to zoom.
- **Spell a word:** click letter tiles, or just type letters on the keyboard; nothing needs to be selected first.
  - **Backspace** removes the last letter.
  - **Enter** plays the word.
  - Click a letter in the word box to take that one back.
- **Hint:** click once to hear the length, twice to place the first letter, three times to see the word.
- **Swap:** click **Swap**, click the tiles you want to replace, then click **Swap 3 tiles for 6 Coins** (the button shows the count). **Cancel** or **Esc** gets out of it free.
- **Road:**
  1. Click **Road**.
  2. Drag across land. The path shows see-through; a red tile can't take a road, and the bar says why.
  3. Click **Confirm**, or press **Enter**.

  **Cancel**, **Esc** or a right-click throws the path away for free. To add more, start a new drag from the end of the path.
- **Bridge:** same as Road, over water or marsh.
- **Clear / Drain:** click the tool, then click one tile at a time. The panel shows the cost of the tile under the mouse.
- **Place a building:**
  1. Click its card. The ghost follows the mouse.
  2. Click to pin it.
  3. Click **Confirm**, or press **Enter**.

  **Cancel** unpins it; **Esc** stops placing.
- **Menu** (top right): Saves, How to Play, and Title Screen. Both of the last two save your town first.

### On a phone

- **Spell a word:** tap letter tiles, then **Submit**.
  - The **delete** key removes the last letter; hold it for half a second to clear the word.
  - Tap a letter in the word box to take it back.
- **Build:** tap **Build** to slide up the panel, then pick a tool or a building. The panel closes and a chip shows the tool; **Done** puts it down.
- **Roads:** drag with one finger, then tap **Confirm** in the bar above the letters.
- **Buildings:** drag the ghost with your finger (the map doesn't move while you do). Lift your finger to pin it, then tap **Confirm**.
- **Look around:** one finger drags the map when no tool is in use; two fingers pinch to zoom.

### Saving

- **Autosave:** your town saves itself one second after every change, and when you close the tab.
- **Menu → Saves:** three slots, Export and Import of one town file, and New town.
- **Older towns:** a town saved by the earlier version (WordCity) still loads. Any road it had on marsh becomes a bridge, free, and a message says how many.

---

## Put it online (GitHub + Vercel), step by step

You only need a web browser for this.

### 1. Put the files on GitHub

1. Unzip the newest zip Claude sent (for example `lexington-v2.0.zip`) on your Mac. You get a folder called `wordcity`.
2. Open your repository on GitHub. If it is still called `wordcity`, rename it first:
   1. Open **Settings** (the tab at the top of the repository).
   2. Under **Repository name**, type `lexington`.
   3. Click **Rename**.
3. On the repository's main page, click **Add file**, then **Upload files**.
4. Open the `wordcity` folder in Finder and select everything inside it (Command + A). Drag the selection onto the GitHub page.
   - Drag the files *inside* the folder, not the folder itself.
   - Finder hides files that start with a dot, like `.gitignore`. Press Command + Shift + . (period) in Finder to show them.
5. Wait for every file to finish uploading, then click **Commit changes**.
6. One old file is not needed any more: `public/favicon.svg`. To delete it on GitHub:
   1. Open the `public` folder and click `favicon.svg`.
   2. Click the **⋯** menu (top right of the file), then **Delete file**.
   3. Click **Commit changes**.

### 2. Vercel

- If the project is already on Vercel, it redeploys by itself after step 1. To rename it:
  1. Open the project on <https://vercel.com>.
  2. Click **Settings**, then **General**.
  3. Change **Project Name** to `lexington` and click **Save**.
- New project:
  1. Go to <https://vercel.com/new> and click **Import** next to the repository.
  2. Don't change any settings; Vercel detects Vite.
  3. Click **Deploy**.

---

## Handy test switches (add to the end of the web address)

| Add this | What it does |
|---|---|
| `?seed=stu` | **New Town** builds the map from the seed "stu" without deleting anything. Autosave is off for that visit, so your real town is never replaced. |
| `?showcase` | **New Town** places one of each of the 11 buildings, so you can see the art in the game. Autosave is off. |
| `?sandbox` | **New Town** unlocks every tier and gives 9,999 of each resource. Autosave is off. For testing only. |
| `?testNoWebGL` | Pretends the graphics card failed, so you can see the "Reload Map" safety screen. |
| `?testDict=corrupt` | Pretends the word list is broken, so you can see the 200-word backup list take over. |
| `?skipTitle` | For automated tests: skips the title screen and starts a new town at once. |

To combine two switches, use `&`. For example: `?seed=stu&sandbox`.

To check the map was only created once: open the browser console (Option + Command + J in Chrome) and type `wordcityDebug`. `appsCreated` should stay at **1**.

---

## For developers

```bash
npm install
npm run dev        # local dev server
npm run build      # production build into dist/
npm run preview    # serve the production build (Section 14 requires this)
npm run typecheck  # TypeScript check (not part of the Vercel build)
```

- **Pinned versions:** `pixi.js` is pinned to exactly `7.4.2` (Section 10), and `idb-keyval` to exactly `6.2.1` (Section 11). Commit `package-lock.json`.
- **The name:** it lives in one constant, `NAME` in `src/game/config.ts`.
- **Game state** lives in `src/game/store.ts`, outside React.
  - The rack is a list of tile objects (Section 5).
  - Road and bridge previews, the placement ghost, Hint and Swap all live there; none of them is ever saved.
- **The Pixi map:** `src/pixi/MapView.tsx` is the only component that touches Pixi. It is mounted once, when a town or the tutorial is first entered, and is only hidden when the player returns to the title screen.
- **Keyboard:** one document-level listener, `src/ui/keyboard.ts`, registered once.
- **Title screen and tutorial:**
  - title screen: `src/ui/TitleScreen.tsx`;
  - tutorial text and fixed data: `src/game/tutorial.ts`;
  - tutorial flow: `src/game/tutorialFlow.ts`;
  - caption panel: `src/ui/Tutorial.tsx`.
- **Saves:**
  - format version 2: `src/game/save.ts`, with `MIGRATIONS[1]` turning v1 marsh roads into bridges;
  - IndexedDB and the tutorial flag: `src/game/persistence.ts`.
- **Terrain polish and blending (Section 13, with the Nov 22, 2026 blending addendum):**
  - `src/pixi/terrainClusters.ts`: patches, depth, and where the mountain peaks stand.
  - `src/pixi/terrainBake.ts`: the one-texture bake, including the soft boundaries between terrains, the marsh and water banks, the peaks, canopies and large trees.
  - `src/pixi/buildingLayer.ts`: the ground tint and contact shadow under every building.
  - The six Gemini polish pieces are wired in (slots in `POLISH_ART` in `src/pixi/terrainVariants.ts`). Their source names map to slots in `POLISH_FILES` in `scripts/art/process_art.py`, so `terrain-peak.jpg`, `terrain-canopy-1.jpg` and the rest can sit with the other JPGs.
  - To replace or add a piece, put the JPG with the other JPGs and run `python3 -I scripts/art/process_art.py <folder of JPGs> src/assets`. No code changes.
- **UI art:** `scripts/art/process_ui.py` keys the game icon, letter tiles and resource icons into `src/assets/ui/`.
- **Boone's scripts:** `scripts/boone/economy_sim.py` and `scripts/boone/find_tutorial_seed.mjs`. To run the simulation from the repository root:

  ```bash
  mkdir -p build-verified && ln -s ../src build-verified/src
  python3 scripts/boone/economy_sim.py 400
  ```
- **Tests:** `?testHooks` exposes the store, the save functions and the tutorial flow to automated browser tests.
