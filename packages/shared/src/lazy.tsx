import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const RELOAD_KEY = 'dingogo.chunkReload';

/** React.lazy for a screen or a heavy part of one (Round 18 code-splitting). If the file can't be fetched — usually a new
 *  release replaced it while the app was open — try once more, then reload the page once to pick up the new release. */
export function lazyWithRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try { return await load(); }
    catch (e) {
      await new Promise((r) => setTimeout(r, 800));
      try { return await load(); }
      catch {
        let reloaded = false;
        try { reloaded = sessionStorage.getItem(RELOAD_KEY) === location.pathname; sessionStorage.setItem(RELOAD_KEY, location.pathname); } catch { /* storage off */ }
        if (!reloaded && typeof navigator !== 'undefined' && navigator.onLine !== false) location.reload();
        throw e;
      }
    }
  });
}

/** Shows `fallback` instead of crashing the screen when a lazy part can't load (no signal, map tiles' code missing). */
export class LoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
