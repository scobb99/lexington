// (v3.0.2) Item A of the v3.0.2 brief: on Stu's iPhone the top of the game sat off screen.
//
// Mechanism, in two layers:
//  1. Stop the page zooming in the first place. The map canvas now takes every touch gesture
//     itself (touch-action: none in styles.css), so a pinch on the map zooms the map, never the
//     page; the rest of the page has touch-action: manipulation (no double-tap zoom). Before this,
//     a pinch on the map zoomed the whole page in mobile Safari, leaving the layout viewport (which
//     every position: fixed layer is anchored to) larger than and offset from what was visible:
//     exactly the "HUD gone, dock clipped at both edges" picture in Stu's recording.
//  2. A safety net that follows the visual viewport. If the page does end up zoomed or scrolled
//     (a pinch on a panel, a browser quirk), this listens to visualViewport resize and scroll
//     events and, while the visible area differs from the layout viewport, pins the whole app
//     (#root) to the visible area: placed at the visual viewport's offset, sized to the layout
//     viewport, and scaled by 1 / zoom from its top-left corner. Every fixed layer inside (HUD,
//     action row, dock, sheet, bars) then sits inside the visible area at its normal size. With no
//     zoom and no offset nothing is applied, so ordinary layout is untouched.
// It also writes --vvh, the visible height in CSS px, which the phone CSS can use where dynamic
// viewport units (dvh) are not supported.

const ENGAGED = 'vv-engaged';

export function startViewportAnchoring(): () => void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const root = document.documentElement;
  if (!vv) return () => undefined;
  const apply = () => {
    const scale = vv.scale || 1;
    const engaged = Math.abs(scale - 1) > 0.01 || Math.abs(vv.offsetLeft) > 0.5 || Math.abs(vv.offsetTop) > 0.5;
    root.style.setProperty('--vvh', `${Math.round(vv.height * scale)}px`);
    if (engaged) {
      root.style.setProperty('--vv-left', `${vv.offsetLeft}px`);
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      root.style.setProperty('--vv-w', `${vv.width * scale}px`);
      root.style.setProperty('--vv-h', `${vv.height * scale}px`);
      root.style.setProperty('--vv-inv', `${1 / scale}`);
    }
    document.body.classList.toggle(ENGAGED, engaged);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);
  apply();
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
