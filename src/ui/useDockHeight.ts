// Keeps a CSS variable, --dock-h, equal to the height of the bottom dock (messages and rack), so
// the phone layout can place the cost bar, the placement bar and the tutorial caption just above
// it (Sections 4, 7 and 17).

import { useEffect } from 'react';

export function useDockHeight(): void {
  useEffect(() => {
    let observed: Element | null = null;
    const ro = new ResizeObserver(() => {
      const h = observed ? Math.round(observed.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--dock-h', `${h}px`);
    });
    const attach = () => {
      const el = document.querySelector('.bottom');
      if (el && el !== observed) {
        if (observed) ro.unobserve(observed);
        observed = el;
        ro.observe(el);
      }
    };
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
}
