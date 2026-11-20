// Layout only (Build Spec v1.8, Section 10). App holds no state, so nothing here can ever
// cause MapView to re-render. The same pieces arrange as a desktop layout or, under 768 px,
// as the phone layout (styles.css): full-screen map, compact top bar, docked rack, and the
// side panel as a bottom sheet.

import { MapErrorBoundary, MapView } from './pixi/MapView';
import { SidePanel } from './ui/BuildPanel';
import { Hud } from './ui/Hud';
import { Messages } from './ui/Messages';
import { Rack } from './ui/Rack';
import { SaveDialog } from './ui/SaveMenu';

export default function App() {
  return (
    <div className="app">
      <Hud />
      <main className="main">
        <section className="map-panel">
          <MapErrorBoundary>
            <MapView />
          </MapErrorBoundary>
        </section>
        <SidePanel />
      </main>
      <footer className="bottom">
        <Messages />
        <Rack />
      </footer>
      <SaveDialog />
    </div>
  );
}
