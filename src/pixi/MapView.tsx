// MapView: the only React component that touches Pixi (Build Spec v1.1, Section 10).
// - The Pixi Application is created once, in a useEffect with an empty dependency list,
//   kept in a useRef, and destroyed only when this component unmounts.
// - MapView takes no props and is memoised, so typing, submitting words, resource changes,
//   and tool selection can never re-render it or create a new Application.
// - MapErrorBoundary wraps MapView alone. If Pixi fails, the word game and panels stay on
//   screen and the map area shows a plain message with a Reload Map button.

import { Component, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { mapFailed } from '../game/store';
import { createMapRuntime, type MapRuntime } from './renderer';

export const MapView = memo(function MapView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MapRuntime | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);

  // Errors raised inside effects or async loads do not reach an Error Boundary on their own;
  // re-throwing during render hands them to MapErrorBoundary.
  if (fatal) throw fatal;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fail = (err: unknown) => setFatal(err instanceof Error ? err : new Error(String(err)));
    try {
      runtimeRef.current = createMapRuntime(host, { onFatal: fail });
    } catch (err) {
      fail(err);
      return;
    }
    return () => {
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="map-host" aria-label="Town map" />;
});

interface BoundaryState {
  error: Error | null;
  attempt: number;
}

export class MapErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[Lexington] The map stopped working:', error);
    mapFailed();
  }

  private reload = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="map-error" role="alert">
          <h2>The map could not be drawn</h2>
          <p>Your words and resources are safe, and you can keep playing the word game.</p>
          <p className="map-error-detail">{this.state.error.message}</p>
          <button className="pill pill-primary" onClick={this.reload}>
            Reload Map
          </button>
        </div>
      );
    }
    // A new key after Reload Map mounts a fresh MapView (the only time a new Application is made).
    return <div className="map-boundary" key={this.state.attempt}>{this.props.children}</div>;
  }
}
