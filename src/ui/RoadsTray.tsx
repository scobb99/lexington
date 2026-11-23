// (v3.0.2) The on-map Roads control (Stu's ruling, Nov 22, 2026: "you buy in Build, you place
// from on screen"). A Roads button sits over the map on the phone and on a computer, in the free
// game and in the tutorial, with the total of banked pieces beside it. It opens a small tray of the
// banked road and bridge pieces by length. Tapping one starts placement at once with the usual
// ghost and piece bar (Rotate, Confirm, Cancel). The tray is not the Build sheet: no quests, no
// catalog, no buying. With nothing banked it says so and offers to open Build at the road bank.

import { PIECE_LENGTHS, type PieceKind, type PieceLen } from '../game/network';
import { pickPiece, setTool, useGame } from '../game/store';
import { isPhone, setUi, useUi } from './uiState';

const KIND_NAME: Record<PieceKind, string> = { road: 'Road', bridge: 'Bridge' };

/** Opens Build at the road bank (the phone's sheet slides up; on a computer the column shows it). */
export function openRoadBank(): void {
  setUi({ roadsOpen: false });
  setTool('road');
  if (isPhone()) setUi({ sheetOpen: true });
  requestAnimationFrame(() => document.querySelector('.piece-bank')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

export function RoadsTray() {
  const open = useUi((u) => u.roadsOpen);
  const sheetOpen = useUi((u) => u.sheetOpen);
  const mode = useGame((s) => s.mode);
  const roadBank = useGame((s) => s.roadBank);
  const bridgeBank = useGame((s) => s.bridgeBank);
  const locks = useGame((s) => s.locks);
  const placing = useGame((s) => !!s.pieceGhost?.anchor);
  if (mode === 'title' || sheetOpen) return null;

  const rows: { kind: PieceKind; len: PieceLen; n: number }[] = [];
  for (const [kind, bank] of [
    ['road', roadBank],
    ['bridge', bridgeBank],
  ] as const) {
    for (const len of PIECE_LENGTHS) if (bank[len] > 0) rows.push({ kind, len, n: bank[len] });
  }
  const total = rows.reduce((a, r) => a + r.n, 0);
  const allowed = (kind: PieceKind) => locks.tools === 'all' || locks.tools.includes(kind);
  const pick = (kind: PieceKind, len: PieceLen) => {
    if (pickPiece(kind, len)) setUi({ roadsOpen: false, sheetOpen: false });
  };

  return (
    <div className={`roads${open ? ' roads-open' : ''}`}>
      <button
        type="button"
        className="pill roads-button"
        data-tour="roads"
        aria-expanded={open}
        onClick={() => setUi({ roadsOpen: !open })}
        disabled={placing}
        title="Your banked road and bridge pieces, ready to lay"
      >
        Roads
        {total > 0 && (
          <span className="pill-count roads-count" aria-label={`${total} pieces banked`}>
            {total}
          </span>
        )}
      </button>
      {open && (
        <div className="roads-tray panel" role="dialog" aria-label="Your road and bridge pieces">
          <div className="roads-head">
            <h2>Your pieces</h2>
            <button type="button" className="pill roads-close" onClick={() => setUi({ roadsOpen: false })}>
              Close
            </button>
          </div>
          {rows.length ? (
            <>
              <ul className="roads-list">
                {rows.map((r) => (
                  <li key={`${r.kind}-${r.len}`}>
                    <button
                      type="button"
                      className="pill roads-piece"
                      data-tray={`${r.kind}-${r.len}`}
                      disabled={!allowed(r.kind)}
                      onClick={() => pick(r.kind, r.len)}
                    >
                      <span>
                        {KIND_NAME[r.kind]}, {r.len} tiles
                      </span>
                      <span className="pill-count">×{r.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="roads-note">Tap a piece, tap the map where it should start, Rotate it, then Confirm. Buy more in Build.</p>
            </>
          ) : (
            <>
              <p className="roads-note roads-empty">No road or bridge pieces in your bank.</p>
              <button type="button" className="pill pill-primary roads-buy" onClick={openRoadBank} disabled={!allowed('road')}>
                Buy pieces in Build
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
