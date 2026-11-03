import { useEffect, useState } from 'react';

let push: (m: string) => void = () => {};
export const toast = (m: string) => push(m);

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: any;
    push = (m) => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 4500); };
    return () => { push = () => {}; clearTimeout(t); };
  }, []);
  return <div className={`toast ${msg ? 'is-on' : ''}`} role="status" aria-live="polite">{msg}</div>;
}
