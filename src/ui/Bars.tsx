// The two confirm bars (Build Spec v2.0):
// - the Section 4 cost bar for a road or bridge preview: path length, total cost, Confirm and
//   Cancel (bottom centre of the map on desktop, above the rack on the phone);
// - the Section 7 placement bar for the ghost: the cost when green, the reason when red, and
//   Confirm and Cancel once the ghost is pinned (beside the ghost on desktop, above the bottom
//   dock on the phone).

import { BUILDINGS } from '../game/buildings';
import { cancelPreview, confirmPlacement, confirmPreview, ghostStatus, previewSummary, setTool, store, unpinGhost, useGame } from '../game/store';
import { footprintAnchor } from '../pixi/camera';
import { useUi } from './uiState';

export function CostBar() {
  useGame((s) => s.preview);
  useGame((s) => s.resources);
  useGame((s) => s.roads);
  const sum = previewSummary();
  if (!sum) return null;
  return (
    <div className="cost-bar panel" role="region" aria-label={sum.kind === 'road' ? 'Road cost' : 'Bridge cost'}>
      <p className="cost-line">{sum.line}</p>
      {sum.problem && <p className="cost-problem">{sum.problem}</p>}
      <div className="cost-buttons">
        <button className="pill pill-primary" onClick={() => confirmPreview()} disabled={!sum.canConfirm}>
          Confirm
        </button>
        <button className="pill" onClick={() => cancelPreview()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PlaceBar() {
  useGame((s) => s.placement);
  useGame((s) => s.resources);
  useGame((s) => s.roads);
  useGame((s) => s.buildings);
  const cam = useGame((s) => s.camera);
  const sheetOpen = useUi((u) => u.sheetOpen);
  const placing = useGame((s) => s.placement);
  const g = ghostStatus();
  if (!placing || sheetOpen) return null;
  if (!g) {
    return (
      <div className="place-bar place-bar-idle panel" role="status">
        <p className="place-line">Move the {BUILDINGS[placing.type].name} over the map.</p>
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
