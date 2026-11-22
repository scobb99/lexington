// Build panel (Build Spec v2.0, Sections 4, 6, 7, 12).
// Tools for roads, bridges, clearing (forest and thicket), draining marsh (from Tier 2) and
// removal, and the building cards with the Section 7 text: a header line, a cost line, a does
// line and a goes line. A locked card says which tier opens it; a card the player cannot afford
// names every missing resource. Selecting an unaffordable card still starts placement, so the
// ghost can teach placement; a locked card does not.

import { useEffect } from 'react';
import { BUILDINGS, CARD_NOTES, CARD_TEXT, TIER_ORDER, anyMissing, lockedLine, missingResources, notEnoughLine } from '../game/buildings';
import { DRAIN_TIER, cancelRemoval, confirmRemoval, setTool, toolChipText, useGame } from '../game/store';
import type { BuildingType, Tool } from '../game/types';
import { formatResources } from '../game/words';
import { MenuButton } from './Menu';
import { TownPanel } from './TownPanel';
import { isPhone, setUi, useUi } from './uiState';

const TOOL_NAMES: Partial<Record<Tool, string>> = { road: 'Road', bridge: 'Bridge', clear: 'Clear', drain: 'Drain', remove: 'Remove' };

const TOOLS: { tool: Tool; label: string; note: string }[] = [
  { tool: 'inspect', label: 'Look', note: 'Click the map to see what is there.' },
  { tool: 'road', label: 'Road', note: '1 Coin per tile. Drag to draw; nothing is charged until you tap Confirm.' },
  { tool: 'bridge', label: 'Bridge', note: '3 Coins and 2 Lumber per tile, over water or marsh. Confirm to build.' },
  { tool: 'clear', label: 'Clear', note: 'Forest: 2 Coins a tile. Thicket: 6 Coins and 3 Lumber a tile.' },
  { tool: 'drain', label: 'Drain', note: 'Marsh: 5 Coins and 2 Lumber a tile. It becomes meadow. Opens at Tier 2.' },
  { tool: 'remove', label: 'Remove', note: 'Roads and bridges: free, no refund. Buildings: half refund.' },
];

const HINTS: Partial<Record<Tool, string>> = {
  inspect: 'Drag to look around. Scroll or pinch to zoom.',
  road: 'Drag across land to draw a road, then tap Confirm. Right-drag or two fingers to pan.',
  bridge: 'Drag across water or marsh to draw a bridge, then tap Confirm.',
  remove: 'Click a road, bridge, or building to remove it.',
};

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

  useEffect(() => {
    if (tool !== 'inspect' && isPhone()) setUi({ sheetOpen: false });
  }, [tool]);
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
  const previewing = useGame((s) => !!s.preview);
  useGame((s) => s.toolTile);

  const allowed = (t: Tool) => t === 'inspect' || locks.tools === 'all' || locks.tools.includes(t);
  const chip = toolChipText();
  const hint = tool in BUILDINGS ? `Move the ${BUILDINGS[tool as BuildingType].name} over the map, then click to pin it and confirm. Esc to stop.` : chip ?? HINTS[tool];

  return (
    <section className="build" aria-label="Build">
      <h2>Build</h2>
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

      {pending && (
        <div className="confirm" role="alertdialog" aria-label="Confirm removal">
          <p>
            Remove the <strong>{BUILDINGS[pending.type].name}</strong>?
          </p>
          <p className="confirm-refund">
            Refund: {formatResources(pending.refund) || 'nothing'}
            <br />
            <span className="muted">Knowledge and Magic are never refunded. There is no undo.</span>
          </p>
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

      <ul className="catalog">
        {TIER_ORDER.map((type) => {
          const def = BUILDINGS[type];
          const card = CARD_TEXT[type];
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
  const card = CARD_TEXT[type];
  return (
    <div className="catalog-item card-copy">
      <span className="card-header">{card.header}</span>
      <span className="card-cost">{card.cost}</span>
      <span className="card-does">{card.does}</span>
      <span className="card-goes">{card.goes}</span>
    </div>
  );
}
