// Layout only (Build Spec v3.0, Sections 10 and 16). Nothing here can ever cause MapView to
// re-render: MapView takes no props and is memoised.
//
// Section 16: the title screen comes first and no town renders behind it, so the game layout
// (and with it the one Pixi Application) is mounted only when a town or the tutorial is
// entered. After that it stays mounted for the life of the page (Section 10: the Application is
// destroyed only when the whole page unmounts); returning to the title screen only hides it.
// Under 768 px the same pieces arrange as the phone layout (styles.css).

import { useEffect, useState } from 'react';
import { MapErrorBoundary, MapView } from './pixi/MapView';
import { useGame } from './game/store';
import { CostBar, PlaceBar } from './ui/Bars';
import { SidePanel } from './ui/BuildPanel';
import { Hud } from './ui/Hud';
import { Messages } from './ui/Messages';
import { OrdersPanel } from './ui/OrdersPanel';
import { NewTownDialog } from './ui/NewTown';
import { Rack } from './ui/Rack';
import { RoadsTray } from './ui/RoadsTray';
import { SaveDialog } from './ui/SaveMenu';
import { TitleScreen } from './ui/TitleScreen';
import { TutorialCaption } from './ui/Tutorial';
import { useDockHeight } from './ui/useDockHeight';

export default function App() {
  const mode = useGame((s) => s.mode);
  const [entered, setEntered] = useState(mode !== 'title');
  useEffect(() => {
    if (mode !== 'title') setEntered(true);
  }, [mode]);
  useDockHeight();

  return (
    <>
      {entered && (
        <div className={`app${mode === 'title' ? ' app-hidden' : ''}${mode === 'tutorial' ? ' app-tutorial' : ''}`} aria-hidden={mode === 'title'}>
          <Hud />
          <main className="main">
            <section className="map-panel">
              <MapErrorBoundary>
                <MapView />
              </MapErrorBoundary>
              <RoadsTray />
              <CostBar />
              <PlaceBar />
              <OrdersPanel />
              <TutorialCaption />
            </section>
            <SidePanel />
          </main>
          <footer className="bottom">
            <Messages />
            <Rack />
          </footer>
        </div>
      )}
      {mode === 'title' && <TitleScreen />}
      <SaveDialog />
      <NewTownDialog />
    </>
  );
}
