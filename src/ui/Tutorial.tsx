// The tutorial's caption panel (Build Spec v2.0, Section 17).
// One caption panel carries every step: bottom centre above the rack on desktop, above the
// bottom dock on the phone. Reading steps have a Next button; action steps advance when the
// player does the action. Every step shows Skip tutorial. The control or place a step teaches
// carries a pulsing gold outline.

import { useEffect, useSyncExternalStore } from 'react';
import { goToTitle } from '../game/session';
import { FRAMES, OFF_PLOT_CAPTION, STEP6_RETRY } from '../game/tutorial';
import { backToTown, endTutorial, getTutorial, nextFrame, skipTutorial, subscribeTutorial, tutorialFromTown } from '../game/tutorialFlow';
import { CardCopy } from './BuildPanel';
import { isPhone, setUi } from './uiState';

/** Where each highlight name points on the page. */
const TARGETS: Record<string, string> = {
  rack: '[data-tour="rack"]',
  submit: '[data-tour="submit"]',
  message: '[data-tour="message"]',
  'hud-resources': '[data-tour="hud-resources"]',
  'road-tool': '[data-tour="road-tool"]',
  'cottage-card': '[data-tour="cottage-card"]',
  'sawmill-card': '[data-tour="sawmill-card"]',
  happiness: '[data-tour="happiness"]',
};

export function TutorialCaption() {
  const t = useSyncExternalStore(subscribeTutorial, getTutorial);
  const frame = FRAMES[t.frame];

  // The pulsing gold outline on the control the step teaches.
  useEffect(() => {
    if (!t.active || !frame.highlight) return;
    const els = [...document.querySelectorAll<HTMLElement>(TARGETS[frame.highlight] ?? '')];
    els.forEach((el) => el.classList.add('tour-pulse'));
    if (frame.highlight === 'cottage-card' || frame.highlight === 'sawmill-card') {
      els[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return () => els.forEach((el) => el.classList.remove('tour-pulse'));
  }, [t.active, t.frame, frame.highlight]);

  // Step 10: the happiness panel opens.
  useEffect(() => {
    if (t.active && t.frame === 'happiness') {
      setUi({ happyOpen: true });
      return () => setUi({ happyOpen: false });
    }
  }, [t.active, t.frame]);

  if (!t.active) return null;
  const lines = Array.isArray(frame.text) ? frame.text : [frame.text];
  const text =
    t.frame === 'road' && t.retry
      ? [STEP6_RETRY]
      : (t.frame === 'cottage' || t.frame === 'sawmill') && t.offPlot
        ? [OFF_PLOT_CAPTION[t.frame]]
        : lines;

  return (
    <div className={`tutorial-caption panel tutorial-${frame.kind}`} role="dialog" aria-label={`Tutorial step ${frame.step}`} aria-live="polite">
      <p className="tutorial-step">
        Step {frame.step} of 11 · {frame.title}
      </p>
      {t.frame === 'cottage' && isPhone() && <CardCopy type="cottage" />}
      <div className="tutorial-text">
        {text.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div className="tutorial-buttons">
        {frame.kind === 'read' && (
          <button className="pill pill-primary" onClick={nextFrame}>
            Next
          </button>
        )}
        {frame.kind === 'finish' && (
          <>
            <button className="pill pill-primary" onClick={() => setUi({ newTownOpen: true })}>
              Start your town
            </button>
            {tutorialFromTown() && (
              <button className="pill" onClick={() => backToTown()}>
                Back to your town
              </button>
            )}
            <button
              className="pill"
              onClick={() => {
                endTutorial();
                void goToTitle();
              }}
            >
              Back to title
            </button>
          </>
        )}
        {frame.kind !== 'finish' && (
          <button className="pill tutorial-skip" onClick={skipTutorial}>
            Skip tutorial
          </button>
        )}
      </div>
    </div>
  );
}
