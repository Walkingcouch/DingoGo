/**
 * Every message DingoGo sends to people — in-app inbox, push and SMS — in one place, so wording stays consistent and plain.
 *
 * Rules: plain Australian English, no emoji, name DingoGo in every text (the sender ID may be a number). SMS text uses only the
 * GSM-7 alphabet (straight quotes, hyphens): one curly quote or dash turns a text into UCS-2 and halves its length.
 * Categories decide which notification settings apply (see services/prefs.ts); `safety` can't be switched off.
 * SMS kinds: `essential` texts go even to numbers that replied STOP (sign-in codes the person just asked for, SOS to an emergency
 * contact); `transactional` texts are skipped for those numbers; `marketing` texts need consent and a number that takes replies.
 */
export type Category = 'trip' | 'chat' | 'account' | 'documents' | 'safety' | 'promo';
export type SmsKind = 'essential' | 'transactional' | 'marketing';
export interface Rendered { title?: string; body?: string; sms?: string }
interface Template<V> { category: Category; smsKind?: SmsKind; render: (v: V) => Rendered }
const t = <V>(x: Template<V>) => x;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const templates = {
  // ── Sign-in and safety (SMS) ──
  otp: t<{ code: string }>({ category: 'account', smsKind: 'essential',
    render: (v) => ({ sms: `Your DingoGo code is ${v.code}. It expires in 10 minutes. Never share this code.` }) }),
  sos_contact: t<{ name: string; ref: string; url: string }>({ category: 'safety', smsKind: 'essential',
    render: (v) => ({ sms: `DingoGo SAFETY ALERT: ${v.name} triggered an emergency alert on trip ${v.ref}. Live location: ${v.url}` }) }),

  // ── Parcels (SMS to people who may not have the app) ──
  parcel_recipient: t<{ sender: string; ref: string; url: string; pin: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.sender} is sending you a parcel (${v.ref}). Track it: ${v.url} - give the driver PIN ${v.pin} on delivery.` }) }),
  parcel_delivered_sender: t<{ ref: string; to: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: parcel ${v.ref} delivered to ${v.to}.` }) }),

  // ── Rider trip updates (texted too for phone bookings, or when the rider asks for texts) ──
  driver_on_way: t<{ again: boolean; driver: string; colour: string; make: string; model: string; rego: string; eta_min: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: v.again ? 'New driver on the way' : 'Driver on the way',
      body: `${v.driver} is coming in a ${v.colour} ${v.make} ${v.model} (${v.rego}). ETA ${v.eta_min} min.`,
      sms: `DingoGo: ${v.driver} is on the way in a ${v.colour} ${v.make} ${v.model}, rego ${v.rego}. About ${v.eta_min} min.`,
    }) }),
  driver_here: t<{ ride: boolean; rego: string; pin: string; ref: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Your driver is here',
      body: v.ride ? `Look for ${v.rego}. Your trip PIN is ${v.pin}.` : `Driver has arrived to collect parcel ${v.ref}.`,
      sms: v.ride ? `DingoGo: your driver is here. Look for rego ${v.rego}. Your trip PIN is ${v.pin}.` : `DingoGo: your driver is here to collect parcel ${v.ref}.`,
    }) }),
  no_drivers: t<{ ref: string; missed: boolean }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'No drivers available',
      body: v.missed
        ? `Sorry, we couldn't get a driver to you in time for your booking ${v.ref}. You have not been charged. Call us and we'll help.`
        : `Sorry, no DingoGo cars are free right now for ${v.ref}. You have not been charged.`,
      sms: v.missed
        ? `DingoGo: sorry, we couldn't get a driver to you in time for booking ${v.ref}. You have not been charged. Call us and we'll help.`
        : `DingoGo: sorry, no cars are free right now for ${v.ref}. You have not been charged.`,
    }) }),
  booking_released: t<{ ref: string }>({ category: 'trip',
    render: (v) => ({ title: 'Finding your driver', body: `We're now matching a driver for your booked trip ${v.ref}.` }) }),
  booking_card_declined: t<{ ref: string; reason?: string | null }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Booking cancelled: card declined',
      body: `We couldn't hold the fare for your booking ${v.ref}. ${v.reason ?? ''} You have not been charged. Book again with another card or DingoGo credit, or call us.`.replace(/\s+/g, ' '),
      sms: `DingoGo: we couldn't hold the fare on your card for booking ${v.ref}, so it is cancelled. You have not been charged. Please book again or call us.`,
    }) }),
  finding_another_driver: t<{ ref: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Finding you another driver',
      body: `Your driver couldn't make it to ${v.ref}, so we're finding you another one. Your booking and price stay the same, with no extra charge.`,
      sms: `DingoGo: your driver couldn't make it, so we're finding you another one for ${v.ref}. Same price, no extra charge.`,
    }) }),
  driver_cancelled: t<{ ref: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Driver cancelled',
      body: `Your driver had to cancel ${v.ref}. You have not been charged. Book again and we'll find you another car.`,
      sms: `DingoGo: your driver had to cancel ${v.ref}. You have not been charged. Book again and we'll find you another car.`,
    }) }),
  trip_done: t<{ ref: string; courier: boolean; cents: number }>({ category: 'trip',
    render: (v) => ({ title: v.courier ? 'Parcel delivered' : 'Thanks for riding DingoGo', body: `${v.ref}: ${money(v.cents)} incl. GST. Your tax invoice is in the app.` }) }),
  route_check: t<{ ref: string }>({ category: 'safety',
    render: (v) => ({ title: 'Is everything OK?', body: `Your trip ${v.ref} has gone off the usual route. Tap to share your trip or get help.` }) }),

  // ── Rider account ──
  payment_failed: t<{ ref: string; cents: number; reason?: string | null }>({ category: 'account',
    render: (v) => ({ title: 'Payment didn\'t go through', body: `We couldn't take ${money(v.cents)} for ${v.ref}. ${v.reason ?? ''} Open the trip to pay.`.replace(/\s+/g, ' ').trim() }) }),
  refund_issued: t<{ ref: string; cents: number; reason: string }>({ category: 'account',
    render: (v) => ({ title: 'Refund issued', body: `We've refunded ${money(v.cents)} on ${v.ref}. ${v.reason}` }) }),
  ticket_received: t<{ id: string }>({ category: 'account',
    render: (v) => ({ title: 'We got your message', body: `Ticket #${v.id.slice(0, 8)} — our team will reply soon.` }) }),
  ticket_reply: t<{ subject: string; resolution: string }>({ category: 'account',
    render: (v) => ({ title: `Re: ${v.subject}`, body: v.resolution }) }),
  referral_bonus: t<{ points: number }>({ category: 'account',
    render: (v) => ({ title: 'Referral bonus', body: `Your friend took their first DingoGo trip — ${v.points} Dingo Points added.` }) }),

  // ── Driver ──
  trip_given_away: t<{ ref: string }>({ category: 'trip',
    render: (v) => ({ title: 'Trip given to another driver', body: `${v.ref} has gone to another driver because we couldn't reach you. Call DingoGo if you were still on your way.` }) }),
  trip_cancelled: t<{ ref: string }>({ category: 'trip', render: (v) => ({ title: 'Trip cancelled', body: `${v.ref} was cancelled.` }) }),
  tip_received: t<{ ref: string; cents: number }>({ category: 'account', render: (v) => ({ title: 'You got a tip', body: `${money(v.cents)} on ${v.ref}` }) }),
  set_offline: t<{ minutes: number }>({ category: 'account',
    render: (v) => ({ title: 'You are offline', body: `We hadn't heard from your phone for ${v.minutes} minutes, so we set you offline. Go online again when you're ready.` }) }),
  driver_approved: t<Record<string, never>>({ category: 'account',
    render: () => ({ title: 'You’re approved', body: 'Welcome to DingoGo. You can now go online and accept trips.' }) }),
  documents_reviewed: t<{ types: string[]; status: string; note?: string | null }>({ category: 'account',
    render: (v) => ({
      title: v.types.length === 1 ? `Document ${v.status}` : `${v.types.length} documents ${v.status}`,
      body: `${v.types.join(', ')}: ${v.status}${v.note ? ' — ' + v.note : ''}`,
    }) }),
  car_reviewed: t<{ approved: boolean; rego: string; note?: string | null }>({ category: 'account',
    render: (v) => ({
      title: v.approved ? 'Your car is approved' : 'Your car was not approved',
      body: v.approved ? `${v.rego} is good to go. You can drive it on DingoGo.` : `${v.rego}: ${v.note ?? 'please contact DingoGo'}`,
    }) }),
  payout_sent: t<{ cents: number }>({ category: 'account', render: (v) => ({ title: 'Payout sent', body: `${money(v.cents)} is on its way to your bank account.` }) }),
  earnings_floor_topup: t<{ cents: number; week: string; rate_cents: number }>({ category: 'account',
    render: (v) => ({ title: 'Earnings floor top-up', body: `${money(v.cents)} added for the week of ${v.week}, so you earned at least ${money(v.rate_cents)} per engaged hour.` }) }),
  document_expiring: t<{ label: string; days_left: number }>({ category: 'documents',
    render: (v) => ({
      title: v.days_left < 0 ? `${v.label} has expired` : v.days_left === 0 ? `${v.label} expires today` : `${v.label} expires in ${v.days_left} day${v.days_left === 1 ? '' : 's'}`,
      body: 'Upload the new one in the app (Profile) so you can keep driving.',
    }) }),

  // ── Trip chat and the relay number ──
  chat_message: t<{ from: 'rider' | 'driver' | 'dingogo'; name?: string | null; text: string }>({ category: 'chat',
    render: (v) => ({
      title: v.from === 'dingogo' ? 'Message from DingoGo' : v.from === 'driver' ? `Message from your driver${v.name ? ', ' + firstName(v.name) : ''}` : `Message from your rider${v.name ? ', ' + firstName(v.name) : ''}`,
      body: v.text,
    }) }),
  chat_relay_sms: t<{ from: 'driver' | 'dingogo'; name?: string | null; text: string }>({ category: 'chat', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo ${v.from === 'driver' ? 'driver' + (v.name ? ' ' + firstName(v.name) : '') : 'team'}: ${v.text} (Reply to this text to answer.)` }) }),
  relay_no_trip_sms: t<{ support?: string | null }>({ category: 'chat', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: we couldn't find a live trip for this number, so your text wasn't passed on.${v.support ? ` For help call ${v.support}.` : ' Please use the DingoGo app.'}` }) }),

  // ── Opt-out keywords (replies to an incoming text) ──
  sms_stop_ack: t<Record<string, never>>({ category: 'account', smsKind: 'essential',
    render: () => ({ sms: 'DingoGo: you won\'t get any more texts from us, including offers. Sign-in codes still come when you ask for one. Reply START to get texts again.' }) }),
  sms_start_ack: t<Record<string, never>>({ category: 'account', smsKind: 'essential',
    render: () => ({ sms: 'DingoGo: texts are back on. Offers stay off unless you turn them on in the app (Account, Notifications). Reply STOP to stop.' }) }),
  sms_help: t<{ support?: string | null }>({ category: 'account', smsKind: 'essential',
    render: (v) => ({ sms: `DingoGo rideshare and courier, Alice Springs.${v.support ? ` Help: ${v.support}.` : ''} Reply STOP to stop texts.` }) }),

  // ── Marketing (only with consent; footer names DingoGo and how to stop) ──
  promo: t<{ title: string; body: string }>({ category: 'promo', smsKind: 'marketing',
    render: (v) => ({
      title: v.title,
      body: `${v.body}\n— DingoGo. Turn off offers in Account › Notifications.`,
      sms: `DingoGo: ${v.body} Reply STOP to opt out.`,
    }) }),
} as const;

export type TemplateKey = keyof typeof templates;
export type VarsOf<K extends TemplateKey> = Parameters<(typeof templates)[K]['render']>[0];

export function render<K extends TemplateKey>(key: K, vars: VarsOf<K>): Rendered & { category: Category; smsKind?: SmsKind } {
  const tpl = templates[key] as Template<any>;
  return { ...tpl.render(vars), category: tpl.category, smsKind: tpl.smsKind };
}

export function firstName(name: string) { return name.trim().split(/\s+/)[0] ?? ''; }

/** The wording shown next to the marketing switch. Stored with every consent record (Spam Act: evidence of consent). */
export const MARKETING_CONSENT_WORDING =
  'Send me DingoGo offers and café deals by notification and text. Optional: trip updates and receipts always come through. Stop any time in Account › Notifications or reply STOP to a text.';

// ── SMS length ──
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€\f';
const gsmSet = new Set([...GSM]);
const extSet = new Set([...GSM_EXT]);

/** How a text is encoded and how many parts it is sent as (each part is billed). */
export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; units: number; segments: number } {
  let units = 0; let gsm = true;
  for (const ch of text) {
    if (gsmSet.has(ch)) units += 1;
    else if (extSet.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  const n = [...text].reduce((s, ch) => s + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return { encoding: 'UCS-2', units: n, segments: n <= 70 ? 1 : Math.ceil(n / 67) };
}

/** Swap the few typographic characters people type (curly quotes, dashes, ellipsis) for GSM ones, so a text isn't sent as UCS-2. */
export function gsmFriendly(text: string) {
  return text.replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ');
}
