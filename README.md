# Lexington

A cozy, word-driven city builder. Built to **Build Spec v3.0** with the Nov 22, 2026 lock amendment.

**Status: v3.0.1 is built** (a patch on v3.0.0; no rule, cost or economy changes):

- **Tutorial fix:** a road piece can no longer cover the marked Cottage or Sawmill plot (the ghost turns red and says why), so the Cottage step can always be finished. If a piece is ever on the plot anyway, Remove can take it off and it goes back to the bank.
- **Easier building steps:** the tutorial card has a **Place the Cottage on the marked plot** button (and one for the Sawmill). Placing by hand still works.
- **Easier to see:** the build steps centre the map on a strongly outlined plot, and on a phone the tutorial card is smaller, so more of the map shows.
- **Roomier town centers:** a new town's town center now goes on the roomiest open meadow in the middle of the map, not the first spot nearest the centre, and the map opens centred on it.

What changed from v2 to v3.0:

- **Words pay Coins, Knowledge and Magic only.** Lumber and Stone come from buildings, Workshop stamps and Commission orders.
- **Town center:** every town starts with one in the middle. It is free, it can't be removed, and every road must connect back to it.
- **Commission orders:** three orders at the town center ("a word with two E's", "a 6 letter word"...). Spell one and it pays a lump of what you need most. Orders never expire; a free discard comes every 5 words.
- **Road and bridge pieces:** buy pieces of 3, 4 or 5 tiles into a bank, then lay them. Laying is free; a removed piece goes back to the bank whole.
- **Growing Rack:** 6 letters to start; 7 at your 2nd Cottage, 8 at your 4th, 9 at the Town Hall.
- **Lantern Hints:** the first Hint on a rack is free and tells you the longest word's length. After that, each Lantern places a letter of a helpful word (two per rack at most). You hold up to 3.
- **Workshop stamps:** a connected Sawmill, Quarry or Market marks a rack tile. Use that tile in a word for 4 extra Lumber or Stone, or double Coins.
- **New helpers:** the **Scribe** (a Reserve Shelf above the rack to keep one letter), the **Rune** from the Wizard Tower (a wild letter you choose), and the **High Street** (a straight road with different buildings beside it makes words pay as if longer).
- **Landmarks:** earned, not bought, at building milestones and other firsts. Each one placed adds 2 to happiness.
- **Living land:** every 20 words forests and thickets may creep onto open meadow; every 50 words the water may flood low meadow into marsh, sometimes leaving a gravel tile (clear it free for 3 Stone).
- **Faint grid lines** on the map, so tiles are easier to read.
- **A new How to Play** (14 steps) that teaches all of the above.

## How to play (controls)

### Starting

- **Continue:** back to your town, just as you left it. It only shows when there is a saved town.
- **New Town:** a fresh map with its town center on roomy open meadow near the middle. If you already have a saved town, type **NEW** to confirm, because the autosave is replaced. Your three save slots are kept.
- **How to Play:** the tutorial. You can **Skip tutorial** at any step.
- **Saves:** load a slot, export a slot to a file, or import a town file.

### On a computer

- **Look around:** drag the map, or scroll to zoom.
- **Spell a word:** click letter tiles, or just type letters. **Backspace** removes the last letter, **Enter** plays the word.
- **Hint:** the first click on a rack is free. Each click after that spends a Lantern and places a letter.
- **Orders:** click **Orders** (beside "Build") to see the three Commission orders.
- **Roads and bridges:**
  1. Click **Road** (or **Bridge**). The bank opens.
  2. Click **Buy** on a length to buy a piece (charged once). Then click the piece in the bank.
  3. Move the mouse over the map and click where the piece should start.
  4. Click **Rotate** until it points the way you want. Green means it can go there; red says why not.
  5. Click **Confirm** (or press **Enter**). Laying a piece costs nothing.

  **Cancel**, **Esc** or a right-click puts the piece back in the bank.
- **Remove:** click **Remove**, then a piece or building. If removing a piece would cut buildings off from the town center, the warning names them first.
- **Clear / Drain:** click the tool, then click one tile at a time. Clearing gravel is free and gives 3 Stone.
- **Place a building:** click its card, click the map to pin the ghost, then **Confirm**. (In How to Play, the Cottage and Sawmill steps also have a button that places the building on the marked plot for you.)
- **Landmarks:** when you earn one, a **Place** button appears in the build panel.

### On a phone

- **Spell a word:** tap letter tiles, then **Submit**. Hold the delete key for half a second to clear the word.
- **Build:** tap **Build** to slide up the panel. For Road or Bridge the panel stays open so you can buy; tap a piece in the bank and the panel closes. Tap the map where the piece starts, **Rotate**, then **Confirm**.
- **Orders:** tap **Orders** at the top right.
- **Buildings:** drag the ghost with your finger, lift to pin it, then tap **Confirm**.

### Saving

- **Autosave:** your town saves itself one second after every change, and when you close the tab.
- **Older towns:** a v2 town still loads. A town center is placed near the middle of the map, old roads become one-tile pieces, your rack is set to its new size, and any landmarks you have already earned are announced.

---

## Put it online (GitHub + Vercel), step by step

You only need a web browser for this.

### 1. Put the files on GitHub

1. Unzip the newest zip Claude sent (for example `lexington-v3.0.1.zip`) on your Mac. You get a folder called `wordcity`.
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
| `?showcase` | **New Town** places one of each building, so you can see the art in the game. Autosave is off. |
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

- **Pinned versions:** `pixi.js` exactly `7.4.2` (Section 10), `idb-keyval` exactly `6.2.1` (Section 11). Commit `package-lock.json`.
- **The name:** one constant, `NAME` in `src/game/config.ts`.
- **Game state** lives in `src/game/store.ts`, outside React. New v3 rule modules:
  - `src/game/network.ts`: pieces, banks, prices, the network from the town center, cascades, High Street;
  - `src/game/orders.ts` and `src/data/orderSolvability.json`: Commission orders and the offline solvability table (regenerate with `node scripts/orders/solvability.mjs`);
  - `src/game/stamps.ts`: Workshop stamps and the Rune;
  - `src/game/landmarks.ts`: landmark milestones;
  - `src/game/terrainChange.ts`: growth and overflow, seeded from the map seed and the word count;
  - `src/game/founding.ts` (v3.0.1): where the town center is founded, for a new town and the v2 migration.
- **The Pixi map:** `src/pixi/MapView.tsx` is the only component that touches Pixi; mounted once. Terrain changes repaint only the changed area of the baked texture (`bakeTerrain(..., { into, region })` in `src/pixi/terrainBake.ts`).
- **Saves:** format version 3 in `src/game/save.ts`; the migration chain is v1 to v2 (marsh roads to bridges) then v2 to v3 (town center, legacy pieces, rack size, landmarks).
- **Tutorial:** text and fixed data in `src/game/tutorial.ts` (every caption is marked BUILD WORDING for Stu to review), flow in `src/game/tutorialFlow.ts`.
- **Placeholder art:** `scripts/art/make_placeholders.py` draws the Town Center, Scribe and landmark stand-ins; `src/assets/sprites.json` lists them under `placeholders`. Replace a PNG with the same name (or rerun `scripts/art/process_art.py` with the Gemini JPGs) and it is picked up with no code change. Stamps, the Rune tile and the Lantern icon are CSS and inline SVG placeholders (`src/styles.css`, `src/ui/Rack.tsx`); gravel is drawn in `drawGravel` in `src/pixi/terrainBake.ts`.
- **Boone's scripts:** `scripts/boone/economy_sim.py` (v2) and `scripts/boone/economy_sim_v3.py` (v3, written by Claude because Boone's v3 script was not in the Drive). From the repository root: `python3 scripts/boone/economy_sim_v3.py 400`.
- **Tests:** `?testHooks` exposes the store, the save functions and the tutorial flow to automated browser tests.
