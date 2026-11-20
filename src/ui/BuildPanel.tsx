// Build panel (Build Spec v1.5, Sections 4, 6, 7, 12).
// Tools for roads, bridges, clearing forest and removal, and the building catalog with exact
// costs. A building the player cannot afford shows which costs are short. Removing a building
// asks for one confirmation that shows the exact refund (Section 7).

import { SavesButton } from './SaveMenu';
import { useEffect, useState } from 'react';
import { BUILDINGS, TIER_ORDER } from '../game/buildings';
import { cancelRemoval, confirmRemoval, setTool, useGame } from '../game/store';
import { RESOURCE_KEYS, RESOURCE_LABELS, type BuildingType, type Tool } from '../game/types';
import { formatResources } from '../game/words';
import { ResourceIcon } from './Hud';
import { TownPanel } from './TownPanel';

/** Section 10 phone layout: narrow screens (under 768 px) use the bottom-sheet arrangement. */
export const PHONE_QUERY = '(max-width: 767px)';
const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.(PHONE_QUERY).matches;

const TOOL_NAMES: Partial<Record<Tool, string>> = { road: 'Road', bridge: 'Bridge', clear: 'Clear forest', remove: 'Remove' };

const TOOLS: { tool: Tool; label: string; note: string }[] = [
  { tool: 'inspect', label: 'Look', note: 'Click the map to see what is there' },
  { tool: 'road', label: 'Road', note: '1 Coin per tile. Drag to draw a road.' },
  { tool: 'bridge', label: 'Bridge', note: '3 Coins and 2 Lumber per tile. Drag across water.' },
  { tool: 'clear', label: 'Clear forest', note: '2 Coins per tile. Opens forest for roads and buildings. Drag to clear.' },
  { tool: 'remove', label: 'Remove', note: 'Roads and bridges: free, no refund. Buildings: half refund.' },
];

const HINTS: Partial<Record<Tool, string>> = {
  inspect: 'Drag to look around. Scroll or pinch to zoom.',
  road: 'Drag across land to draw a road. Right-drag or two fingers to pan.',
  bridge: 'Drag across the river to build a bridge.',
  clear: 'Drag over forest to clear it (2 Coins per tile). Thicket cannot be cleared.',
  remove: 'Click a road, bridge, or building to remove it.',
};

const PRODUCES: Partial<Record<BuildingType, string>> = {
  cottage: 'Houses 3',
  sawmill: '+2 Lumber per word',
  quarry: '+2 Stone per word',
  market: '+2 Coins per word',
  library: '+1 Knowledge per word',
  pier: '+1 Coin, +1 Lumber per word',
  park: 'Happiness +5',
  greenhouse: '+1 Lumber, +1 Knowledge per word',
  tavern: '+1 Coin per word',
  townHall: 'Happiness +10',
  wizardTower: '+1 Magic per 5 words; doubles rare-letter Magic',
};

/**
 * The side column on desktop. On a phone it becomes a bottom sheet opened with the Build
 * button; choosing a tool closes the sheet so the map is free for placing, and a small chip
 * shows the active tool with a Done button.
 */
export function SidePanel() {
  const [open, setOpen] = useState(false);
  const tool = useGame((s) => s.tool);
  const pending = useGame((s) => s.pendingRemoval);

  useEffect(() => {
    if (tool !== 'inspect' && isPhone()) setOpen(false);
  }, [tool]);
  useEffect(() => {
    if (pending && isPhone()) setOpen(true);
  }, [pending]);

  const toolName = tool in BUILDINGS ? BUILDINGS[tool as BuildingType].name : TOOL_NAMES[tool];

  return (
    <>
      <aside className={`side${open ? ' sheet-open' : ''}`} aria-label="Town and build">
        <button className="sheet-close pill" onClick={() => setOpen(false)} aria-label="Close">
          Close
        </button>
        <TownPanel />
        <BuildPanel />
      </aside>
      <div className="phone-actions">
        {toolName && !open && (
          <div className="tool-chip" role="status">
            <span>Using {toolName}</span>
            <button className="pill" onClick={() => setTool('inspect')}>
              Done
            </button>
          </div>
        )}
        {!open && <SavesButton className="phone-saves" />}
        <button className="pill pill-primary sheet-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
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

  // Escape puts the tools down (and cancels a pending removal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      cancelRemoval();
      setTool('inspect');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hint = tool in BUILDINGS ? `Click the map to place the ${BUILDINGS[tool as BuildingType].name}. Esc to stop.` : HINTS[tool];

  return (
    <section className="build" aria-label="Build">
      <h2>Build</h2>
      <div className="tool-row">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`pill${tool === t.tool ? ' pill-selected' : ''}`}
            onClick={() => setTool(tool === t.tool && t.tool !== 'inspect' ? 'inspect' : t.tool)}
            title={t.note}
            aria-pressed={tool === t.tool}
          >
            {t.label}
          </button>
        ))}
      </div>
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
          const locked = def.tier > tier;
          const selected = tool === type;
          return (
            <li key={type}>
              <button
                className={`catalog-item${selected ? ' catalog-selected' : ''}`}
                disabled={locked}
                onClick={() => setTool(selected ? 'inspect' : type)}
                aria-pressed={selected}
                title={locked ? `Unlocks at Tier ${def.tier}` : `Place a ${def.name}`}
              >
                <span className="catalog-head">
                  <span className="catalog-name">{def.name}</span>
                  <span className="catalog-size">{locked ? `Tier ${def.tier}` : `${def.w}×${def.h}`}</span>
                </span>
                <span className="cost">
                  {RESOURCE_KEYS.filter((k) => def.cost[k] > 0).map((k) => {
                    const short = !locked && resources[k] < def.cost[k];
                    return (
                      <span
                        key={k}
                        className={`cost-chip${short ? ' cost-short' : ''}`}
                        title={short ? `${def.cost[k] - resources[k]} more ${RESOURCE_LABELS[k]} needed` : RESOURCE_LABELS[k]}
                      >
                        <ResourceIcon kind={k} size={14} />
                        {def.cost[k]}
                      </span>
                    );
                  })}
                </span>
                {!locked && PRODUCES[type] && <span className="catalog-note">{PRODUCES[type]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
