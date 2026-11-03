import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Msg } from '@dingogo/shared';

export type OpsCtx = { events: Msg[]; counts: Record<string, number>; refreshCounts: () => void; openSos: any[] };
export const Ops = createContext<OpsCtx>({ events: [], counts: {}, refreshCounts: () => {}, openSos: [] });
export const useOps = () => useContext(Ops);

export function Page({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${title} | DingoGo Ops`; }, [title]);
  return (<>
    <header className="topbar"><h1>{title}</h1><span className="spacer" />{right}</header>
    <div className="content">{children}</div>
  </>);
}
