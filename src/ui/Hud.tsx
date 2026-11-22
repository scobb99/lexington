// Top resource bar (Build Spec v2.0, Sections 3, 6, 8, 10, 16).
// Subscribes only to small interface values: resources, tier, buildings and roads (for the
// derived population and happiness). Tapping Happiness shows how the score is made up.
// On a phone this becomes the compact top bar. Resource icons are simple flat shapes in the map palette,
// bright enough to read on the dark panels.

import { useEffect, useRef } from 'react';
import { NAME } from '../game/config';
import { currentHappiness, currentHappinessBreakdown, useGame } from '../game/store';
import { MenuButton } from './Menu';
import iconCoin from '../assets/ui/icon-coin.png?url';
import iconLumber from '../assets/ui/icon-lumber.png?url';
import iconStone from '../assets/ui/icon-stone.png?url';
import iconKnowledge from '../assets/ui/icon-knowledge.png?url';
import iconMagic from '../assets/ui/icon-magic.png?url';
import { setUi, useUi } from './uiState';
import { population } from '../game/buildings';
import { RESOURCE_KEYS, RESOURCE_LABELS, type ResourceKey } from '../game/types';
import { happinessMultiplier } from '../game/words';

/** Section 3 UI art: the Gemini resource icons (coin, lumber, stone, knowledge book, magic sparkle). */
const ICONS: Record<ResourceKey, string> = {
  coins: iconCoin,
  lumber: iconLumber,
  stone: iconStone,
  knowledge: iconKnowledge,
  magic: iconMagic,
};

export function ResourceIcon({ kind, size = 20 }: { kind: ResourceKey; size?: number }) {
  return <img className="resource-icon" src={ICONS[kind]} width={size} height={size} alt="" aria-hidden draggable={false} />;
}

/** Short form for the phone's compact top bar: 980, 9.8k, 12k. */
export function shortNumber(v: number): string {
  if (v < 1000) return String(v);
  if (v < 10000) return `${(Math.floor(v / 100) / 10).toFixed(1)}k`;
  return `${Math.floor(v / 1000)}k`;
}

const BANDS: [string, string][] = [
  ['80 to 100', 'x1.2'],
  ['60 to 79', 'x1.1'],
  ['40 to 59', 'x1.0'],
  ['20 to 39', 'x0.9'],
  ['0 to 19', 'x0.8'],
];

export function Hud() {
  const resources = useGame((s) => s.resources);
  const tier = useGame((s) => s.tier);
  const buildings = useGame((s) => s.buildings);
  useGame((s) => s.roads); // road links change happiness (Section 8)
  const pop = population(buildings);
  const happy = currentHappiness();
  const mult = happinessMultiplier(happy);
  const showHappy = useUi((u) => u.happyOpen);
  const mode = useGame((s) => s.mode);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHappy || mode === 'tutorial') return;
    const close = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setUi({ happyOpen: false });
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [showHappy, mode]);

  return (
    <header className="hud panel">
      <h1 className="brand">{NAME}</h1>
      <ul className="resources" aria-label="Resources" data-tour="hud-resources">
        {RESOURCE_KEYS.map((k) => (
          <li key={k} className="resource" title={RESOURCE_LABELS[k]}>
            <ResourceIcon kind={k} />
            <span className="resource-value">{resources[k]}</span>
            <span className="resource-short">{shortNumber(resources[k])}</span>
            <span className="resource-label">{RESOURCE_LABELS[k]}</span>
          </li>
        ))}
      </ul>
      <ul className="town-stats" aria-label="Town">
        <li title="Tier">
          <span className="stat-label">Tier</span> {tier}
        </li>
        <li title="Population: 3 per Cottage">
          <span className="stat-label">Pop.</span> {pop}
        </li>
        <li className="happy-wrap">
          <button
            className="happy-chip"
            data-tour="happiness"
            onClick={() => setUi({ happyOpen: !showHappy })}
            aria-expanded={showHappy}
            title={`Happiness ${happy}: word rewards x${mult.toFixed(1)}. Tap for details.`}
          >
            <span className="stat-label">Happy</span> {happy} <span className="stat-mult">x{mult.toFixed(1)}</span>
          </button>
          {showHappy && (
            <div className="happy-pop" ref={popRef} role="dialog" aria-label="Happiness">
              <h3>Happiness {happy}</h3>
              <ul className="happy-parts">
                {currentHappinessBreakdown().map((p) => (
                  <li key={p.label}>
                    <span>{p.label}</span>
                    <span className={p.value < 0 ? 'neg' : 'pos'}>
                      {p.label === 'Base' ? p.value : (p.value > 0 ? '+' : '') + p.value}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="happy-note">Happiness only changes word rewards. It never blocks building and never decays.</p>
              <ul className="happy-bands">
                {BANDS.map(([range, m]) => (
                  <li key={range} className={`x${mult.toFixed(1)}` === m ? 'current' : ''}>
                    <span>{range}</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      </ul>
      {mode === 'town' && <MenuButton className="hud-menu" />}
    </header>
  );
}
