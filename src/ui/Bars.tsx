// The two confirm bars (Build Spec v3.0):
// - the Section 4 piece bar for a picked road or bridge piece: Rotate, Confirm and Cancel
//   (bottom centre of the map on desktop, above the rack on the phone);
// - the Section 7 placement bar for the ghost: the cost when green, the reason when red, and
//   Confirm and Cancel once the ghost is pinned (beside the ghost on desktop, above the bottom
//   dock on the phone).

import { BUILDINGS, LANDMARK_NAMES } from '../game/buildings';
import { DIR_NAMES } from '../game/network';
import { cancelPiece, confirmPiece, confirmPlacement, ghostStatus, pieceStatus, rotatePiece, setTool, store, unpinGhost, useGame } from '../game/store';
import { footprintAnchor } from '../pixi/camera';
import { useUi } from './uiState';

/** (v3.0) Section 4: the curved-arrow rotate symbol. */
function RotateIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <path d="M15.5 9.5a5.5 5.5 0 1 1-1.8-4.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M14.2 1.8l.2 4.2-4.2.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * (v3.0) Section 4: the piece bar while a road or bridge piece is picked: what the piece is, the
 * red reason when it cannot go there, and Rotate (live until Confirm), Confirm and Cancel.
 */
export function PieceBar() {
  const ghost = useGame((s) => s.pieceGhost);
  useGame((s) => s.roads);
  useGame((s) => s.buildings);
  const sheetOpen = useUi((u) => u.sheetOpen);
  if (!ghost || sheetOpen) return null;
  const st = pieceStatus();
  const what = `${ghost.kind === 'road' ? 'Road' : 'Bridge'} piece, ${ghost.len} tiles, running ${DIR_NAMES[ghost.dir]}.`;
  return (
    <div className={`cost-bar piece-bar panel${st ? (st.ok ? ' place-ok' : ' place-bad') : ''}`} role="region" aria-label={ghost.kind === 'road' ? 'Place a road piece' : 'Place a bridge piece'}>
      <p className="cost-line">{what}</p>
      <p className={st && !st.ok ? 'cost-problem' : 'cost-hint'}>{!st ? 'Tap the map where the piece should start.' : st.ok ? 'Green: it can go here. Nothing is charged; it was paid for.' : st.reason}</p>
      <div className="cost-buttons">
        <button className="pill rotate-button" onClick={() => rotatePiece()} aria-label="Rotate the piece" title="Rotate">
          <RotateIcon /> Rotate
        </button>
        <button className="pill pill-primary" onClick={() => confirmPiece()} disabled={!st?.ok}>
          Confirm
        </button>
        <button className="pill" onClick={() => cancelPiece()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Kept name for the layout: the old road cost bar is now the piece bar. */
export const CostBar = PieceBar;

export function PlaceBar() {
  useGame((s) => s.placement);
  useGame((s) => s.resources);
  useGame((s) => s.roads);
  useGame((s) => s.buildings);
  const cam = useGame((s) => s.camera);
  const sheetOpen = useUi((u) => u.sheetOpen);
  const placing = useGame((s) => s.placement);
  const pick = useGame((s) => s.landmarkPick);
  const g = ghostStatus();
  if (!placing || sheetOpen) return null;
  const name = placing.type === 'landmark' && pick ? LANDMARK_NAMES[pick] : BUILDINGS[placing.type].name;
  if (!g) {
    return (
      <div className="place-bar place-bar-idle panel" role="status">
        <p className="place-line">Move the {name} over the map.</p>
        <div className="place-buttons">
          <button className="pill" onClick={() => setTool('inspect')}>
            Done
          </button>
        </div>
      </div>
    );
  }
  const def = BUILDINGS[g.type];
  // Desktop: the bar sits beside the ghost (just under its footprint's front corner).
  const at = footprintAnchor(g.x, g.y, def.w, def.h);
  // Kept inside the map panel so the bar never runs off its edge.
  const view = store.state.cameraView;
  const sx = Math.min(Math.max(at.x * cam.zoom + cam.x, 170), Math.max(170, view.w - 170));
  const sy = Math.min(Math.max(at.y * cam.zoom + cam.y + 12, 12), Math.max(12, view.h - 110));
  const style = { left: `${Math.round(sx)}px`, top: `${Math.round(sy)}px` };
  return (
    <div className={`place-bar panel${g.ok ? ' place-ok' : ' place-bad'}${g.pinned ? ' place-pinned' : ''}`} style={style} role="region" aria-label="Place building">
      <p className="place-line">{g.line}</p>
      {g.pinned && (
        <div className="place-buttons">
          <button className="pill pill-primary" onClick={() => confirmPlacement()} disabled={!g.ok}>
            Confirm
          </button>
          <button className="pill" onClick={() => unpinGhost()}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
