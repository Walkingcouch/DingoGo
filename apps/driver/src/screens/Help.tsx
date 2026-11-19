/** Round 22: driver help — lost property cases to answer, your messages with replies, help articles and a message form. */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DriverLostItems, HelpCentre, MyTickets, NewTicket, get, useLoad } from '@dingogo/shared';
import type { HelpAction } from '@dingogo/shared';

export function Help() {
  const nav = useNavigate();
  const cfg = useLoad(() => get('/public/config'));
  const [sent, setSent] = useState(0);
  const form = useRef<HTMLDivElement>(null);
  const phone = cfg.data?.support?.phone;
  const onAction = (a: HelpAction) => {
    if (a === 'trip_help' || a === 'safety') nav('/trips');
    else if (a === 'earnings') nav('/earnings');
    else if (a === 'profile') nav('/profile');
    else if (a === 'call') window.location.href = 'tel:000';
    else form.current?.scrollIntoView({ behavior: 'smooth' });
  };
  return (
    <div className="screen" tabIndex={0} aria-label="Help">
      <h1>Help</h1>
      <p className="dg-callout"><strong>In danger?</strong> Call <a href="tel:000">000</a>. On a trip, use SOS.</p>
      {phone && <p>Talk to a person: <a href={`tel:${String(phone).replace(/\s/g, '')}`}>{phone}</a>{cfg.data?.support?.hours ? `, ${cfg.data.support.hours}` : ''}.</p>}
      <p className="dg-muted">For help with one trip (a found item, pay, a safety problem), open Trips and tap Get help on that trip.</p>
      <DriverLostItems />
      <MyTickets audience="driver" reloadKey={sent} />
      <HelpCentre audience="driver" onAction={onAction} />
      <div ref={form}><NewTicket audience="driver" onSent={() => setSent((n) => n + 1)} /></div>
    </div>
  );
}
