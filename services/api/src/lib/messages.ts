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
  // Round 11: booked with a pickup window; on its way with an ETA; couldn't be delivered; back with the sender.
  parcel_recipient_booked: t<{ sender: string; ref: string; url: string; pin: string; when: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.sender} is sending you a parcel (${v.ref}), collected ${v.when}. Track it: ${v.url} - give the driver PIN ${v.pin} on delivery.` }) }),
  // Round 12: an organisation booking rides for a client. The client is told, and how to stop it.
  client_consent_recorded: t<{ org: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: `${v.org} can book rides for you`,
      body: `${v.org} can now book DingoGo rides for you. To stop this, go to Account, Organisations, or call DingoGo.`,
      sms: `DingoGo: ${v.org} can now book rides for you. You'll get a text for each trip. To stop this, call DingoGo or use the app (Account, Organisations).`,
    }) }),
  concession_reviewed: t<{ approved: boolean; note: string | null }>({ category: 'account',
    render: (v) => v.approved
      ? { title: 'Concession fares are on', body: 'Your concession card is checked. Concession prices show when you book.' }
      : { title: 'Concession card not approved', body: `We couldn't approve your concession card${v.note ? `: ${v.note}` : ''}. You can send it again in Account.` } }),
  // Round 13: driver applicants from the website (they have no account yet, so texts only) get a private status link.
  driver_application_received: t<{ ref: string; url: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: thanks for applying to drive (ref ${v.ref}). We'll call you within a few days. See where it's up to: ${v.url}` }) }),
  driver_application_update: t<{ ref: string; stage: string; url: string }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: your driver application ${v.ref} is now at "${v.stage}". Details: ${v.url}` }) }),
  ride_booked_for_you: t<{ org: string; ref: string; when: string; pickup: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Ride booked for you',
      body: `${v.org} booked ride ${v.ref} for you, ${v.when}, from ${v.pickup}.`,
      sms: `DingoGo: ${v.org} booked ride ${v.ref} for you, ${v.when}, from ${v.pickup}. We'll text when your driver is on the way.`,
    }) }),
  parcel_on_way: t<{ sender: string; ref: string; eta: string; url: string; safe_place: string | null }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: your parcel from ${v.sender} (${v.ref}) is on its way, arriving about ${v.eta}.${v.safe_place ? ` If you're out it will be left: ${v.safe_place}.` : ''} Track: ${v.url}` }) }),
  parcel_failed_recipient: t<{ sender: string; ref: string; reason: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: we couldn't deliver your parcel from ${v.sender} (${v.ref}): ${v.reason}. It is going back to the sender, who will be in touch.` }) }),
  parcel_failed_sender: t<{ ref: string; to: string; reason: string; fee_cents: number }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({
      title: 'Parcel not delivered',
      body: `${v.ref} to ${v.to}: ${v.reason}. The driver is bringing it back to you${v.fee_cents > 0 ? ` (return ${money(v.fee_cents)})` : ''}. Book another try from the trip.`,
      sms: `DingoGo: parcel ${v.ref} to ${v.to} couldn't be delivered (${v.reason}). The driver is bringing it back to you.`,
    }) }),
  parcel_returned_sender: t<{ ref: string; to: string }>({ category: 'trip', smsKind: 'transactional',
    render: (v) => ({ title: 'Parcel returned', body: `${v.ref} for ${v.to} is back with you. Book another try from the trip.`, sms: `DingoGo: parcel ${v.ref} for ${v.to} has been returned to you.` }) }),

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

  // ── Round 14: safety and trust ──
  safety_check: t<{ ref: string; reason: 'long_stop' | 'route_deviation' | 'ops'; minutes: number }>({ category: 'safety',
    render: (v) => ({
      title: 'Are you OK?',
      body: `${v.reason === 'long_stop' ? `Your car has been stopped for a while on ${v.ref}.` : v.reason === 'route_deviation' ? `Your trip ${v.ref} has gone off the usual route.` : `DingoGo is checking in on ${v.ref}.`} Tap "I'm OK" or "Get help". If we don't hear back in ${v.minutes} min, our team will check on you.`,
    }) }),
  trip_shared: t<{ name: string; driver: string; car: string; rego: string; url: string }>({ category: 'safety', smsKind: 'transactional',
    render: (v) => ({ sms: `DingoGo: ${v.name} shared their ride with you. Driver ${v.driver}, ${v.car}, rego ${v.rego}. Follow it live: ${v.url}` }) }),
  check_in_escalated_contact: t<{ name: string; ref: string; url: string }>({ category: 'safety', smsKind: 'essential',
    render: (v) => ({ sms: `DingoGo SAFETY: ${v.name} asked for help or didn't answer a safety check on trip ${v.ref}. Our team is checking now. Live location: ${v.url} If they are in danger call 000.` }) }),
  fatigue_warning: t<{ minutes: number; kind: 'daily_limit' | 'break' }>({ category: 'safety',
    render: (v) => ({ title: v.kind === 'break' ? 'Break coming up' : 'Daily limit coming up', body: `About ${v.minutes} min until ${v.kind === 'break' ? 'your break' : 'your daily limit'}. After that you'll be set offline once your trip ends.` }) }),
  fatigue_offline: t<{ kind: 'daily_limit' | 'break'; until: string; hours: string }>({ category: 'safety',
    render: (v) => ({ title: v.kind === 'break' ? 'Time for a break' : 'Time to rest', body: `You've been online ${v.hours}. We've set you offline. You can go online again from ${v.until}.` }) }),
  identity_check_reviewed: t<{ approved: boolean; note: string | null }>({ category: 'safety',
    render: (v) => v.approved
      ? { title: 'Photo check approved', body: 'Thanks. Your photo check is approved.' }
      : { title: 'Photo check not accepted', body: `We couldn't match your photo to your account${v.note ? `: ${v.note}` : ''}. Take a new photo before going online, or call DingoGo.` } }),
  incident_received: t<{ ref: string; critical: boolean }>({ category: 'safety',
    render: (v) => ({ title: 'We got your safety report', body: `Report ${v.ref}: our safety team will look at it${v.critical ? ' today and may call you' : ' and get back to you'}. In danger now? Call 000.` }) }),
  incident_update: t<{ ref: string; outcome: string | null }>({ category: 'safety',
    render: (v) => ({ title: 'Your safety report', body: `We've finished looking into report ${v.ref}.${v.outcome ? ` ${v.outcome}` : ''} Thanks for telling us.` }) }),
  account_restricted: t<{ kind: 'suspend' | 'ban'; reason: string; until: string | null }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: v.kind === 'ban' ? 'Your account is closed' : 'Your account is on hold',
      body: `${v.reason}${v.until ? ` Until ${v.until}.` : ''} You can ask us to look again from the sign-in screen.`,
      sms: `DingoGo: your account is ${v.kind === 'ban' ? 'closed' : 'on hold'}${v.until ? ` until ${v.until}` : ''}. ${v.reason} To ask us to look again, sign in to the DingoGo app.`,
    }) }),
  account_restored: t<Record<string, never>>({ category: 'account', smsKind: 'transactional',
    render: () => ({ title: 'Your account is active again', body: 'You can use DingoGo again.', sms: 'DingoGo: your account is active again. You can sign in and use the app.' }) }),
  appeal_decided: t<{ overturned: boolean; note: string | null }>({ category: 'account', smsKind: 'transactional',
    render: (v) => ({
      title: v.overturned ? 'Appeal accepted' : 'Appeal decided',
      body: v.overturned ? 'We looked again and your account is active.' : `We looked again and the decision stays.${v.note ? ` ${v.note}` : ''}`,
      sms: v.overturned ? 'DingoGo: we looked again at your appeal and your account is active.' : 'DingoGo: we looked again at your appeal and the decision stays. Sign in to the app for details.',
    }) }),

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
  const m = tpl.render(vars);
  // Text built from what people typed (safe places, names) can carry curly quotes or dashes: keep it GSM-7.
  return { ...m, ...(m.sms ? { sms: gsmFriendly(m.sms) } : {}), category: tpl.category, smsKind: tpl.smsKind };
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
