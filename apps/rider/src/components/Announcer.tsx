import { useEffect, useState } from 'react';

let push: (text: string, urgent: boolean) => void = () => {};
/** Say something to screen-reader users without moving focus. `urgent` interrupts (driver arrived, trip cancelled). */
export const announce = (text: string, urgent = false) => push(text, urgent);

/** Two always-present live regions (polite and assertive). Mounted once in App, outside any screen, so they exist before the
 *  first message: screen readers ignore live regions that appear together with their text. */
export function Announcer() {
  const [polite, setPolite] = useState('');
  const [urgent, setUrgent] = useState('');
  useEffect(() => {
    push = (text, isUrgent) => {
      const set = isUrgent ? setUrgent : setPolite;
      // Clear first so the same words said twice are still read out.
      set(''); setTimeout(() => set(text), 60);
    };
    return () => { push = () => {}; };
  }, []);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{urgent}</div>
    </>
  );
}
