// Top resource bar (Build Spec v1.7, Sections 3, 6, 8, 10).
// Subscribes only to small interface values: resources, tier, buildings and roads (for the
// derived population and happiness). Tapping Happiness shows how the score is made up.
// On a phone this becomes the compact top bar. Resource icons are simple flat shapes in the map palette,
// bright enough to read on the dark panels.

import { SavesButton } from './SaveMenu';
import { useEffect, useRef, useState } from 'react';
import { currentHappiness, currentHappinessBreakdown, useGame } from '../game/store';
import { population } from '../game/buildings';
import { RESOURCE_KEYS, RESOURCE_LABELS, type ResourceKey } from '../game/types';
import { happinessMultiplier } from '../game/words';

export function ResourceIcon({ kind, size = 20 }: { kind: ResourceKey; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  switch (kind) {
    case 'coins':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="#f2c94c" />
          <circle cx="12" cy="12" r="6" fill="none" stroke="#c9952b" strokeWidth="1.6" />
          <circle cx="9.5" cy="9" r="1.6" fill="#fff3c4" />
        </svg>
      );
    case 'lumber':
      return (
        <svg {...common}>
          <rect x="3" y="8" width="16" height="9" rx="4.5" fill="#b07a45" />
          <ellipse cx="18.5" cy="12.5" rx="3.2" ry="4.5" fill="#e3b680" />
          <ellipse cx="18.5" cy="12.5" rx="1.6" ry="2.4" fill="none" stroke="#b07a45" strokeWidth="1" />
          <path d="M6 11h7M5 14h9" stroke="#8f5f33" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'stone':
      return (
        <svg {...common}>
          <path d="M4 15l3-7 7-2 6 5-1 7-9 2z" fill="#c9c6bd" />
          <path d="M7 8l7-2 3 3-6 2z" fill="#e6e3da" />
          <path d="M10 20l1-6 8-3" fill="none" stroke="#9e9a90" strokeWidth="1.2" />
        </svg>
      );
    case 'knowledge':
      return (
        <svg {...common}>
          <path d="M3 6c3-1 6-1 9 1v12c-3-2-6-2-9-1z" fill="#6fb3d9" />
          <path d="M21 6c-3-1-6-1-9 1v12c3-2 6-2 9-1z" fill="#8cc6e6" />
          <path d="M5 9c2-.5 3.5-.3 5 .5M5 12c2-.5 3.5-.3 5 .5M14 9.5c1.5-.8 3-1 5-.5" stroke="#f4ead5" strokeWidth="1" fill="none" />
        </svg>
      );
    case 'magic':
      return (
        <svg {...common}>
          <path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z" fill="#b79cf0" />
          <circle cx="10" cy="9.5" r="1.4" fill="#efe6ff" />
        </svg>
      );
  }
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
  const [showHappy, setShowHappy] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHappy) return;
    const close = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowHappy(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [showHappy]);

  return (
    <header className="hud panel">
      <h1 className="brand">WordCity</h1>
      <ul className="resources" aria-label="Resources">
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
            onClick={() => setShowHappy((v) => !v)}
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
      <SavesButton className="hud-saves" />
    </header>
  );
}
