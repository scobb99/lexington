// Build panel (Build Spec v3.0, Sections 4, 6, 7, 12, 18 and 21).
// (v3.0) The Road and Bridge tools list their bank by length with a Buy line for each; the
// Landmarks row lists earned landmarks waiting to be placed; the removal confirmation carries the
// cascade warning; the Orders button opens the town center's orders panel.
// Tools for roads, bridges, clearing (forest and thicket), draining marsh (from Tier 2) and
// removal, and the building cards with the Section 7 text: a header line, a cost line, a does
// line and a goes line. A locked card says which tier opens it; a card the player cannot afford
// names every missing resource. Selecting an unaffordable card still starts placement, so the
// ghost can teach placement; a locked card does not.

import { useEffect } from 'react';
import { BUILDINGS, CARD_NOTES, CARD_TEXT, LANDMARK_NAMES, TIER_ORDER, anyMissing, costWords, lockedLine, missingResources, notEnoughLine } from '../game/buildings';
import { PIECE_LENGTHS, PIECE_PRICE, type PieceKind } from '../game/network';
import {
  DRAIN_TIER,
  buyPiece,
  cancelRemoval,
  confirmRemoval,
  landmarksWaiting,
  openOrders,
  pickLandmark,
  pickPiece,
  removalWarning,
  setTool,
  toolChipText,
  useGame,
} from '../game/store';
import type { BuildingType, Tool } from '../game/types';
import { formatResources } from '../game/words';
import { MenuButton } from './Menu';
import { TownPanel } from './TownPanel';
import { isPhone, setUi, useUi } from './uiState';

const TOOL_NAMES: Partial<Record<Tool, string>> = { road: 'Road', bridge: 'Bridge', clear: 'Clear', drain: 'Drain', remove: 'Remove' };

const TOOLS: { tool: Tool; label: string; note: string }[] = [
  { tool: 'inspect', label: 'Look', note: 'Click the map to see what is there. Tap the town center for its orders.' },
  { tool: 'road', label: 'Road', note: 'Buy road pieces of 3, 4 or 5 tiles, then lay them. Pieces must join your network.' },
  { tool: 'bridge', label: 'Bridge', note: 'Buy bridge pieces of 3, 4 or 5 tiles to cross water or marsh. A bridge must land at one end.' },
  { tool: 'clear', label: 'Clear', note: 'Forest: 2 Coins a tile. Thicket: 6 Coins and 3 Lumber a tile. Gravel: free, and it gives 3 Stone.' },
  { tool: 'drain', label: 'Drain', note: 'Marsh: 5 Coins and 2 Lumber a tile. It becomes meadow. Opens at Tier 2.' },
  { tool: 'remove', label: 'Remove', note: 'A road or bridge piece goes back to its bank whole. Buildings: half refund.' },
];

const HINTS: Partial<Record<Tool, string>> = {
  inspect: 'Drag to look around. Scroll or pinch to zoom.',
  road: 'Pick a piece from your bank (or buy one), tap where it should start, rotate it, then Confirm.',
  bridge: 'Pick a bridge piece, tap where it should start over the water, rotate it, then Confirm.',
  remove: 'Click a road piece, bridge piece, or building to remove it.',
};

/** (v3.0) Section 4: the bank by length, each with its Buy line. */
function PieceBank({ kind }: { kind: PieceKind }) {
  const bank = useGame((s) => (kind === 'road' ? s.roadBank : s.bridgeBank));
  const ghost = useGame((s) => s.pieceGhost);
  const resources = useGame((s) => s.resources);
  const word = kind === 'road' ? 'road' : 'bridge';
  return (
    <div className="piece-bank" aria-label={`${kind === 'road' ? 'Road' : 'Bridge'} bank`}>
      <h3>{kind === 'road' ? 'Road bank' : 'Bridge bank'}</h3>
      <ul>
        {PIECE_LENGTHS.map((len) => {
          const price = PIECE_PRICE[kind][len];
          const short = anyMissing(missingResources(resources, price));
          const picked = ghost?.kind === kind && ghost.len === len;
          return (
            <li key={len} className="bank-row">
              <button
                className={`pill bank-pick${picked ? ' pill-selected' : ''}`}
                disabled={bank[len] <= 0 || (!!ghost?.anchor && !picked)}
                onClick={() => pickPiece(kind, len)}
                data-piece={`${kind}-${len}`}
              >
                {len} tiles: {bank[len]} in the bank
              </button>
              <button className="pill bank-buy" disabled={short || !!ghost?.anchor} onClick={() => buyPiece(kind, len)} data-buy={`${kind}-${len}`} title={`Buy a ${len} tile ${word} piece`}>
                Buy {costWords(price)}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="tool-hint">Buying charges once. Laying a banked piece is free, and a removed piece comes back to the bank whole. Pieces are never sold back.</p>
    </div>
  );
}

function toolLabel(tool: Tool): string | undefined {
  return tool in BUILDINGS ? BUILDINGS[tool as BuildingType].name : TOOL_NAMES[tool];
}

/**
 * The side column on desktop. On a phone it becomes a bottom sheet opened with the Build
 * button; choosing a tool closes the sheet so the map is free for placing, and a small chip
 * shows the active tool with a Done button.
 */
export function SidePanel() {
  const open = useUi((u) => u.sheetOpen);
  const tool = useGame((s) => s.tool);
  const pending = useGame((s) => s.pendingRemoval);
  const mode = useGame((s) => s.mode);
  useGame((s) => s.toolTile);
  useGame((s) => s.resources);

  const ghost = useGame((s) => s.pieceGhost);
  // On the phone, choosing a tool closes the sheet so the map is free; the Road and Bridge tools
  // keep it open until a piece is picked from the bank.
  useEffect(() => {
    if (tool !== 'inspect' && tool !== 'road' && tool !== 'bridge' && isPhone()) setUi({ sheetOpen: false });
  }, [tool]);
  useEffect(() => {
    if (ghost && isPhone()) setUi({ sheetOpen: false });
  }, [ghost?.kind, ghost?.len, !!ghost]);
  useEffect(() => {
    if (pending && isPhone()) setUi({ sheetOpen: true });
  }, [pending]);

  const name = toolLabel(tool);
  const chip = toolChipText();

  return (
    <>
      <aside className={`side${open ? ' sheet-open' : ''}`} aria-label="Town and build">
        <button className="sheet-close pill" onClick={() => setUi({ sheetOpen: false })} aria-label="Close">
          Close
        </button>
        <TownPanel />
        <BuildPanel />
      </aside>
      <div className="phone-actions">
        {name && !open && (
          <div className="tool-chip" role="status">
            <span>{chip ?? `Using ${name}`}</span>
            <button className="pill" onClick={() => setTool('inspect')}>
              Done
            </button>
          </div>
        )}
        {!open && mode === 'town' && <MenuButton className="phone-menu" />}
        {!open && mode !== 'title' && (
          <button className="pill orders-button" onClick={() => openOrders(true)}>
            Orders
          </button>
        )}
        <button className="pill pill-primary sheet-toggle" onClick={() => setUi({ sheetOpen: !open })} aria-expanded={open}>
          {open ? 'Close' : 'Build'}
        </button>
      </div>
    </>
  );
}

export function BuildPanel() {
  const tool = useGame((s) => s.tool);
  const tier = useGame((s) => s.tier);
  const resources = useGame((s) => s.resources);
  const pending = useGame((s) => s.pendingRemoval);
  const locks = useGame((s) => s.locks);
  const previewing = useGame((s) => !!s.pieceGhost?.anchor);
  const earned = useGame((s) => s.landmarksEarned);
  useGame((s) => s.buildings);
  useGame((s) => s.toolTile);
  const waiting = landmarksWaiting();
  void earned;

  const allowed = (t: Tool) => t === 'inspect' || locks.tools === 'all' || locks.tools.includes(t);
  const chip = toolChipText();
  const hint = tool in BUILDINGS ? `Move the ${BUILDINGS[tool as BuildingType].name} over the map, then click to pin it and confirm. Esc to stop.` : chip ?? HINTS[tool];

  return (
    <section className="build" aria-label="Build">
      <div className="build-head">
        <h2>Build</h2>
        <button className="pill orders-button orders-desktop" onClick={() => openOrders(true)} data-tour="orders">
          Orders
        </button>
      </div>
      <div className="tool-row">
        {TOOLS.map((t) => {
          const drainLocked = t.tool === 'drain' && tier < DRAIN_TIER;
          return (
            <button
              key={t.tool}
              className={`pill${tool === t.tool ? ' pill-selected' : ''}`}
              onClick={() => setTool(tool === t.tool && t.tool !== 'inspect' ? 'inspect' : t.tool)}
              title={t.note}
              aria-pressed={tool === t.tool}
              disabled={drainLocked || !allowed(t.tool) || (previewing && tool !== t.tool)}
              data-tour={t.tool === 'road' ? 'road-tool' : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tier < DRAIN_TIER && <p className="tool-locked">Drain: Opens at Tier 2.</p>}
      {hint && <p className="tool-hint">{hint}</p>}
      {(tool === 'road' || tool === 'bridge') && <PieceBank kind={tool} />}

      {pending && (
        <div className="confirm" role="alertdialog" aria-label="Confirm removal">
          {pending.kind === 'building' ? (
            <>
              <p>
                Remove the <strong>{BUILDINGS[pending.type].name}</strong>?
              </p>
              <p className="confirm-refund">
                Refund: {formatResources(pending.refund) || 'nothing'}
                <br />
                <span className="muted">Knowledge and Magic are never refunded. There is no undo.</span>
              </p>
            </>
          ) : (
            <p className={pending.names.length ? 'confirm-cascade' : ''}>{removalWarning(pending)}</p>
          )}
          <div className="confirm-buttons">
            <button className="pill pill-danger" onClick={confirmRemoval}>
              Remove
            </button>
            <button className="pill" onClick={cancelRemoval}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="landmarks-row" aria-label="Landmarks">
          <h3>Landmarks</h3>
          <p className="tool-hint">Earned, not bought. Each one placed adds 2 to happiness.</p>
          {waiting.map((id) => (
            <button key={id} className="pill landmark-pick" disabled={!allowed('landmark')} onClick={() => pickLandmark(id)}>
              Place {LANDMARK_NAMES[id]}
            </button>
          ))}
        </div>
      )}

      <ul className="catalog">
        {TIER_ORDER.map((type) => {
          const def = BUILDINGS[type];
          const card = CARD_TEXT[type]!;
          const locked = def.tier > tier;
          const missing = missingResources(resources, def.cost);
          const short = anyMissing(missing);
          const selected = tool === type;
          // Section 7: when both apply, the locked line shows.
          const stateLine = locked ? lockedLine(def.tier) : short ? notEnoughLine(missing) : null;
          return (
            <li key={type}>
              <button
                className={`catalog-item${selected ? ' catalog-selected' : ''}${locked ? ' catalog-locked' : ''}${short && !locked ? ' catalog-short' : ''}`}
                aria-disabled={locked}
                disabled={!allowed(type) || (previewing && !selected)}
                onClick={() => (locked ? setTool(type) : setTool(selected ? 'inspect' : type))}
                aria-pressed={selected}
                data-tour={type === 'cottage' ? 'cottage-card' : type === 'sawmill' ? 'sawmill-card' : undefined}
              >
                <span className="card-header">{card.header}</span>
                <span className="card-cost">{card.cost}</span>
                {stateLine ? <span className={`card-state${locked ? ' card-locked' : ' card-short'}`}>{stateLine}</span> : <span className="card-does">{card.does}</span>}
                <span className="card-goes">{card.goes}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="card-notes">
        {CARD_NOTES.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </section>
  );
}

/** A copy of one card, for the tutorial caption on the phone (Section 17 step 7). */
export function CardCopy({ type }: { type: BuildingType }) {
  const card = CARD_TEXT[type]!;
  return (
    <div className="catalog-item card-copy">
      <span className="card-header">{card.header}</span>
      <span className="card-cost">{card.cost}</span>
      <span className="card-does">{card.does}</span>
      <span className="card-goes">{card.goes}</span>
    </div>
  );
}
