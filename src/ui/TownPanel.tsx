// Town panel (Build Spec v3.0, Sections 9, 12, 17 and 19): the current quest with its progress and reward,
// and what the next tier needs. Quests are optional and never expire, so this panel only
// informs; nothing here can be failed or missed.

import { useGame, disconnectedBuildings, highStreetNow, nextTierRequirements, progressInputs } from '../game/store';
import { buildingName } from '../game/buildings';
import { CHAIN_COMPLETE, FREE_PLAY, QUESTS, type Requirement } from '../game/progress';
import { formatResources } from '../game/words';

function Checklist({ items }: { items: Requirement[] }) {
  return (
    <ul className="checklist">
      {items.map((r) => (
        <li key={r.label} className={r.met ? 'met' : ''}>
          <span className="check" aria-hidden>
            {r.met ? '✓' : '○'}
          </span>
          <span className="check-label">{r.label}</span>
          <span className="check-count">
            {Math.min(r.have, r.need)}/{r.need}
          </span>
          {!r.met && r.need > 1 && (
            <span className="bar" aria-hidden>
              <span style={{ width: `${Math.min(100, (100 * r.have) / r.need)}%` }} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TownPanel() {
  // These values change whenever progress can change, so the panel re-renders then.
  const questIndex = useGame((s) => s.questIndex);
  const mode = useGame((s) => s.mode);
  const tier = useGame((s) => s.tier);
  useGame((s) => s.resources);
  useGame((s) => s.buildings);
  useGame((s) => s.roads);
  useGame((s) => s.lifetime);

  // Section 17: quests do not run in the tutorial town, and it stays at Tier 1.
  if (mode === 'tutorial') {
    return (
      <section className="town" aria-label="Town goals">
        <div className="quest">
          <h3>Tutorial town</h3>
          <p className="quest-goal">Quests start in your own town, beginning with First Words. Nothing here is saved.</p>
        </div>
      </section>
    );
  }
  const quest = QUESTS[questIndex];
  const inputs = progressInputs();
  const nextTier = nextTierRequirements();

  return (
    <section className="town" aria-label="Town goals">
      <div className="quest">
        <h3>
          {quest ? (
            <>
              Quest {questIndex + 1} of {QUESTS.length}: {quest.title}
            </>
          ) : (
            'Town complete'
          )}
        </h3>
        {quest ? (
          <>
            <p className="quest-goal">{quest.goal}</p>
            <Checklist items={quest.progress(inputs)} />
            <p className="quest-reward">Reward: {formatResources(quest.reward)}</p>
          </>
        ) : (
          <p className="quest-goal">
            {CHAIN_COMPLETE} {FREE_PLAY}
          </p>
        )}
      </div>
      <TownNotes />
      <div className="tier-progress">
        <h3>{tier >= 3 ? 'Tier 3: every building unlocked' : `Next: Tier ${tier + 1}`}</h3>
        {nextTier.length > 0 && <Checklist items={nextTier} />}
      </div>
    </section>
  );
}

/**
 * (v3.0) Section 12: buildings that stand but are not connected are listed with the not-connected
 * line; Section 19: the current High Street bonus.
 */
function TownNotes() {
  useGame((s) => s.net);
  useGame((s) => s.buildings);
  const cut = disconnectedBuildings();
  const street = highStreetNow();
  return (
    <div className="town-notes">
      <p className="high-street">
        {street.bonus > 0 ? `High Street bonus: plus ${street.bonus} length.` : 'No High Street yet. A straight road of 6 or more tiles, with buildings beside it, makes your words pay longer.'}
      </p>
      {cut.length > 0 && (
        <ul className="disconnected" aria-label="Not connected">
          {cut.map((b) => (
            <li key={b.id}>{buildingName(b)} is not connected to the town center and pays nothing.</li>
          ))}
        </ul>
      )}
    </div>
  );
}
