# WordCity

A cozy, word-driven city builder. Built to **Build Spec v1.8**.

**Status: Phase 4, the last build phase.** Everything in the spec is built:

- The seeded 54 × 54 map in a three-quarter isometric view (64 × 40 tiles), painted once into a single texture using the approved Gemini terrain art and its variants.
- The word game, with real rewards, rerolls, and the free reroll when no word is possible.
- **Building your town:** roads, bridges, clearing forest (2 Coins a tile), all 11 buildings placed by the Section 7 rules, and removal with a refund shown first.
- **Growing your town:** three tiers, the 8-quest chain with rewards, and happiness and population shown at the top.
- **Saves:** your town saves itself as you play, and comes back when you return. There are three manual save slots, plus Export and Import of a town file.
- **Desktop and phone layouts.** On a narrow screen (under 768 px) the map fills the screen and the panels move out of the way.
- The dark interface.

What's left before launch is one check with the real Pixi and Vite tools (see "For developers"), then putting it online.

## How to play (controls)

### On a computer

- **Look around:** drag the map, or scroll or pinch to zoom.
- **Make a word:** type it and press **Enter**, or click letter tiles and then **Submit**.
- **Build a road:** click **Road** in the Build panel, then drag across land. Each tile costs 1 Coin.
- **Build a bridge:** click **Bridge**, then drag across the river. Each tile costs 3 Coins and 2 Lumber.
- **Open up forest:** click **Clear forest**, then drag over forest tiles. Each tile costs 2 Coins.
- **Place a building:** click it in the Build panel, then click the map.
  - Green footprint: the spot is allowed. Red: it isn't; click anyway to see the reason.
- **Remove something:** click **Remove**, then click a road, bridge, or building.
- **Put the tool down:** press **Esc**.
- **Pan while using a tool:** drag with the right mouse button, or with two fingers.

### Quests, tiers and happiness

- The **Town** card at the top of the right-hand panel shows the current quest, its progress bars and its reward, and a checklist for the next tier.
- Quests and tier unlocks pay out on their own the moment they are done. A gold message announces them.
- Click the **Happy** chip at the top right to see how happiness is worked out and what it does to word rewards. Click anywhere else to close it.

### Saving your town

- **Autosave:** the game saves itself one second after every change. Close the tab whenever you like; next time you open the game, your town is just as you left it.
- **Saves button** (top right on a computer, next to Build on a phone) opens the Saves panel:
  - **Slot 1 to 3:** *Save here* keeps a copy of your town. *Load* brings it back (it asks first, because it replaces your current town). A filled slot says *Replace*, and asks before overwriting.
  - **Export** downloads your town as one file (for example `wordcity-town-2026-11-20.json`). **Import** loads a file like that back in, on this or another computer or phone.
  - **New town** starts a fresh map. It deletes the autosave (your three slots are kept), so you must type **NEW** first. You can also type a map seed.
- Saves live in this browser on this device. To move a town to another device, Export it on the old one and Import it on the new one.
- A save that is damaged or from a newer version is never loaded: you get a plain message and your town is unchanged.

### On a phone

- **Make a word:** tap letter tiles in order, then tap **Submit**. Tap a used tile again to take its letter back. You can also type in the box.
- **Build:** tap the **Build** button (top right) to slide up the Build panel. The Town card with quests is at the top of it.
- Pick a tool or building. The panel closes and a **Using …** chip appears; drag or tap on the map. Tap **Done** to put the tool down.
- **Look around:** drag with one finger (when no tool is chosen), pinch with two fingers to zoom. With a tool chosen, two fingers pan.
- Tap the **☺** number in the top bar for the happiness breakdown.
- Tap **Saves** (next to Build) for the save slots, Export, Import and New town.

---

## Put it online (GitHub + Vercel), step by step

You only need a web browser for this.

### 1. Put the files on GitHub

1. Unzip the newest zip Claude sent (for example `wordcity-phase3.zip`) on your Mac. You get a folder called `wordcity`.
2. Go to <https://github.com/new>.
3. Type `wordcity` as the **Repository name**. Leave everything else as it is. Click **Create repository**.
4. On the next page, click the link that says **uploading an existing file**.
5. Open the `wordcity` folder in Finder and select everything inside it (Command + A).
   - Drag the selection into the GitHub page.
   - Drag the files *inside* the folder, not the folder itself.
   - Some files start with a dot, like `.gitignore`, and Finder hides them. Press Command + Shift + . (period) in Finder to show them.
6. Wait for every file to finish uploading. Then click **Commit changes**.

### 2. Deploy on Vercel

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Find `wordcity` in the list and click **Import**.
3. Vercel detects **Vite** on its own. Don't change any settings.
4. Click **Deploy**. After a minute or two, Vercel gives you a web address for the game.

### 3. Updating later

When Claude sends new files, upload them to the same GitHub repository the same way (step 1, parts 4 to 6). Vercel then redeploys automatically.

---

## Handy test switches (add to the end of the web address)

| Add this | What it does |
|---|---|
| `?seed=stu` | Builds the map from the seed "stu". The same seed always gives the same map. Autosave is paused for that visit, so your real town is never replaced. (To play a seeded map for real, use **New town** in Saves and type the seed there.) |
| `?showcase` | Places one of each of the 11 buildings on the map so you can see the art in the game. They don't count toward the economy and are never saved. Autosave is paused. |
| `?sandbox` | Unlocks every tier and gives 9,999 of each resource, so you can try placing everything. Quests still run. Autosave is paused. For testing only. |
| `?testNoWebGL` | Pretends the graphics card failed, so you can see the "Reload Map" safety screen. |
| `?testDict=corrupt` | Pretends the word list is broken, so you can see the 200-word backup list take over. |

To combine two switches, use `&`. For example: `?seed=stu&testDict=corrupt`.

To try the phone layout on a computer: in Chrome, open the console (Option + Command + J), click the phone-and-tablet icon at its top left, and pick a phone such as iPhone 12 Pro (390 × 844).

To check that the map was only created once: open the browser console (Option + Command + J in Chrome) and type `wordcityDebug`. `appsCreated` should stay at **1** while you type and play.

---

## For developers

```bash
npm install
npm run dev        # local dev server
npm run build      # production build into dist/
npm run preview    # serve the production build (Section 14 requires this)
npm run typecheck  # TypeScript check (not part of the Vercel build)
```

- `pixi.js` is pinned to exactly `7.4.2` (Section 10), and `idb-keyval` to exactly `6.2.1` (Section 11). Commit `package-lock.json` after the first `npm install`.
- Game state lives in `src/game/store.ts`, outside React.
- `src/pixi/MapView.tsx` is the only component that touches Pixi. It creates the Pixi Application once.
- The word list is `src/data/words.txt` (one lower-case word per line). It is bundled into the app and parsed after the map first paints.
- The view is isometric (64 × 40 diamonds) over a square logic grid. The projection lives in `src/pixi/camera.ts`.
- Building art: the approved Gemini set, keyed to PNG in `src/assets/buildings/` (anchors and sizes in `sprites.json`).
- Terrain art: the approved Gemini tiles and variants, cut into splats and prop stamps in `src/assets/terrain/` (see `terrain.json`).
- Where each variant goes: `src/pixi/terrainVariants.ts` (one manifest line per variant, plus the five placement rules).
- To add a terrain variant:
  1. Put the JPG (e.g. `terrain-water-2.jpg`) with the others.
  2. Run `python3 -I scripts/art/process_art.py <folder of JPGs> src/assets` (needs Python with numpy, scipy and Pillow).
  3. Add one line to the manifest.
- Tiers and quests (Section 9) are pure rules in `src/game/progress.ts`; the store checks them after every word, build and removal. The Town card is `src/ui/TownPanel.tsx`.
- The phone layout is CSS only (`@media (max-width: 767px)` in `src/styles.css`) plus the bottom-sheet toggle in `src/ui/BuildPanel.tsx`. The map is never remounted when the layout changes.
- Saves (Section 11): the format and all its checks are in `src/game/save.ts` (pure, unit-tested); IndexedDB, the autosave and Export/Import are in `src/game/persistence.ts`; the panel is `src/ui/SaveMenu.tsx`. To change the save format, raise `SAVE_VERSION` and add a step to `MIGRATIONS` so old saves still load.
- `?testHooks` exposes the game store to automated browser tests.
