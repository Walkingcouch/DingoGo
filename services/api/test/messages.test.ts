/** Message wording, SMS length, opt-out keywords, Twilio signatures and Web Push encryption. No database, no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { templates, render, smsSegments, gsmFriendly, type TemplateKey } from '../src/lib/messages.js';
import { keyword, twilioSignature, checkTwilioSignature, twiml, e164 } from '../src/services/sms.js';
import { encryptWebPush, generateVapidKeys, vapidAuthHeader } from '../src/services/push.js';
import { mergePrefs, pushAllowed, DEFAULT_PREFS } from '../src/services/prefs.js';
import { config } from '../src/config.js';
import { decryptWebPush } from './helpers/webpush.js';

const sample: Record<string, any> = {
  otp: { code: '123456' }, sos_contact: { name: 'Mary Smith', ref: 'DG-ABC123', url: 'https://dingogo.com.au/track/abcdefghijklmnop' },
  parcel_recipient: { sender: 'Mary Smith', ref: 'DG-ABC123', url: 'https://dingogo.com.au/track/abcdefghijklmnop', pin: '4821' },
  parcel_delivered_sender: { ref: 'DG-ABC123', to: 'Jo Bloggs' },
  parcel_recipient_booked: { sender: 'Central Pharmacy Mparntwe', ref: 'DG-ABC123', url: 'https://dingogo.com.au/track/abcdefghijklmnop', pin: '4821', when: 'Thu 2:00-4:00 pm' },
  parcel_on_way: { sender: 'Central Pharmacy Mparntwe', ref: 'DG-ABC123', eta: '2:40 pm', url: 'https://dingogo.com.au/track/abcdefghijklmnop', safe_place: 'behind the side gate under the verandah' },
  parcel_failed_recipient: { sender: 'Central Pharmacy Mparntwe', ref: 'DG-ABC123', reason: 'Couldn’t get in (locked gate, dogs, no access)' },
  parcel_failed_sender: { ref: 'DG-ABC123', to: 'Jo Bloggs', reason: 'Nobody home and no safe place allowed', fee_cents: 600 },
  parcel_returned_sender: { ref: 'DG-ABC123', to: 'Jo Bloggs' },
  driver_on_way: { again: false, driver: 'Sam Driver', colour: 'White', make: 'Toyota', model: 'Camry Hybrid', rego: 'CD12AB', eta_min: 4 },
  driver_here: { ride: true, rego: 'CD12AB', pin: '1234', ref: 'DG-ABC123' }, no_drivers: { ref: 'DG-ABC123', missed: true },
  booking_released: { ref: 'DG-ABC123' }, booking_card_declined: { ref: 'DG-ABC123', reason: 'Your card was declined.' },
  finding_another_driver: { ref: 'DG-ABC123' }, driver_cancelled: { ref: 'DG-ABC123' }, trip_done: { ref: 'DG-ABC123', courier: false, cents: 2350 },
  route_check: { ref: 'DG-ABC123' }, payment_failed: { ref: 'DG-ABC123', cents: 2350, reason: null }, refund_issued: { ref: 'DG-ABC123', cents: 500, reason: 'Late' },
  ticket_received: { ref: 'ST-ABC123', reply_by: 'Thu 2:40 pm' }, ticket_reply: { subject: 'Lost hat', resolution: 'Found it' },
  ticket_resolved: { ref: 'ST-ABC123', subject: 'I left something in the car' }, lost_item_driver: { ref: 'DG-ABC123', item: 'Black wallet with a Centrelink card' },
  lost_item_found: { ref: 'DG-ABC123', item: 'Black wallet', asked: true }, lost_item_not_found: { ref: 'DG-ABC123' }, lost_item_collect: { ref: 'DG-ABC123', item: 'Black wallet' },
  lost_item_courier: { ref: 'DG-XYZ789', address: 'Todd Mall, Alice Springs' }, referral_bonus: { points: 500 },
  points_expiring: { points: 1250, date: '19 December 2026' }, birthday_bonus: { points: 200 }, streak_bonus: { points: 300, weeks: 4 },
  gift_voucher: { from: 'Aunty Mary Smith', cents: 5000, code: 'DGABC234XY56', expires: '19 November 2029' },
  trip_given_away: { ref: 'DG-ABC123' }, trip_cancelled: { ref: 'DG-ABC123' }, tip_received: { ref: 'DG-ABC123', cents: 300 }, set_offline: { minutes: 30 },
  driver_approved: {}, documents_reviewed: { types: ['licence'], status: 'approved' }, car_reviewed: { approved: false, rego: 'CD12AB', note: 'Blurry photo' },
  payout_sent: { cents: 12000 }, earnings_floor_topup: { cents: 1500, week: '2026-11-09', rate_cents: 3200 },
  fleet_arrears: { cents: 22666, rego: 'CA 34 DG' }, fleet_bought_out: {}, fleet_car_off_road: { spare: 'CA 12 DG' }, fleet_car_back: {}, document_expiring: { label: 'Driver licence', days_left: 14 },
  chat_message: { from: 'driver', name: 'Sam Driver', text: "I'm here" }, chat_relay_sms: { from: 'driver', name: 'Sam Driver', text: "I'm outside. Look for my rego." },
  relay_no_trip_sms: { support: '08 8950 0000' }, sms_stop_ack: {}, sms_start_ack: {}, sms_help: { support: '08 8950 0000' },
  concession_reviewed: { approved: false, note: 'Card has expired' },
  client_consent_recorded: { org: 'Tangentyere Health Transport Service' },
  tour_booked_for_you: { partner: 'Desert Palms Resort Front Desk', tour: 'West MacDonnell Gaps', ref: 'DG-ABC123', when: 'Thu 21 Nov 7:00 am', pickup: 'Desert Palms Resort, Barrett Drive' },
  tour_advisory: { ref: 'DG-ABC123', tour: 'West MacDonnell Gaps', title: 'Extreme heat', message: 'Forecast 44 degrees. Walks must start by 8 am.', free: true },
  guide_assigned: { tour: 'West MacDonnell Gaps', when: 'Thu 21 Nov 7:00 am', pickup: 'Desert Palms Resort, Barrett Drive', ref: 'DG-ABC123', cents: 12000 },
  hire_quote: { name: 'Jordan', cents: 168000, url: 'https://dingogo.com.au/hire/abcdefghijklmnopqrstuvwx', days: 14 },
  business_application_received: { org: 'Mparntwe Renal Health Aboriginal Corporation', ref: 'BA-ABC234' },
  business_account_approved: { org: 'Mparntwe Renal Health Aboriginal Corporation', terms: 30 },
  business_account_declined: { org: 'Mparntwe Renal Health Aboriginal Corporation', note: 'We need a trading address for the account first' },
  business_member_added: { org: 'Mparntwe Renal Health Aboriginal Corporation', role: 'approver', by: 'Rita' },
  business_approval_needed: { org: 'Mparntwe Renal Health', ref: 'DG-ABC123', who: 'Sam', when: 'Thu 2:00 pm', cents: 4520 },
  business_trip_approved: { ref: 'DG-ABC123', when: 'Thu 2:00 pm' },
  business_trip_declined: { ref: 'DG-ABC123', when: 'Thu 2:00 pm', note: 'Use the shuttle bus.' },
  business_trip_unapproved: { ref: 'DG-ABC123', when: 'Thu 2:00 pm' },
  regular_rides_booked: { org: 'Rita at Mparntwe Renal Health Aboriginal Corporation', days: 'Mon, Wed and Fri', time: '7:15 am',
    pickup: 'Larapinta Valley Town Camp, Larapinta Drive', next: 'Mon 7:15 am' },
  recurring_problem: { ref: 'REG-ABC234', date: '24 Nov 2026 7:15 am', reason: 'Cost centre RENAL has reached its monthly budget' },
  invoice_issued: { org: 'Mparntwe Renal Health', number: 'INV-202611-0007', cents: 128450, due: '31 December 2026' },
  invoice_overdue: { org: 'Mparntwe Renal Health Aboriginal Corporation', number: 'INV-202611-0007', cents: 128450, days: 14 },
  ride_booked_for_you: { org: 'Tangentyere Health Transport Service', ref: 'DG-ABC123', when: 'Thu 2:00 pm', pickup: 'Alice Springs Hospital' },
  driver_application_received: { ref: 'DA-ABC123', url: 'https://dingogo.com.au/drive/status/abcdefghijklmnopqrst' },
  driver_application_update: { ref: 'DA-ABC123', stage: "We've called", url: 'https://dingogo.com.au/drive/status/abcdefghijklmnopqrst' },
  safety_check: { ref: 'DG-ABC123', reason: 'long_stop', minutes: 3 },
  trip_shared: { name: 'Mary Smith', driver: 'Sam', car: 'White Toyota Camry Hybrid', rego: 'CD12AB', url: 'https://dingogo.com.au/track/abcdefghijklmnop' },
  check_in_escalated_contact: { name: 'Mary Smith', ref: 'DG-ABC123', url: 'https://dingogo.com.au/track/abcdefghijklmnopqrst' },
  fatigue_warning: { minutes: 30, kind: 'daily_limit' }, fatigue_offline: { kind: 'break', until: '3:40 pm', hours: '5 h' },
  identity_check_reviewed: { approved: false, note: 'Face hidden by a hat' },
  incident_received: { ref: 'IR-ABC123', critical: true }, incident_update: { ref: 'IR-ABC123', outcome: 'We have taken action.' },
  account_restricted: { kind: 'suspend', reason: 'Abusive or threatening behaviour towards a driver, rider or our team.', until: '30 Nov 2026' },
  account_restored: {}, appeal_decided: { overturned: false, note: null },
  promo: { title: 'Cheap Tuesdays', body: '20% off rides to the Todd Mall markets this Sunday.' },
};
const EMOJI = /\p{Extended_Pictographic}/u;

test('templates: every message renders, no emoji, texts name DingoGo and fit in plain GSM-7 (sign-in code in one text)', () => {
  for (const key of Object.keys(templates) as TemplateKey[]) {
    assert.ok(sample[key], `sample vars for ${key}`);
    const m = render(key, sample[key]);
    assert.ok(m.title || m.sms, `${key} renders something`);
    for (const part of [m.title, m.body, m.sms]) if (part) assert.ok(!EMOJI.test(part), `${key}: no emoji`);
    if (m.sms) {
      assert.match(m.sms, /DingoGo/, `${key}: text names DingoGo`);
      const seg = smsSegments(m.sms);
      assert.equal(seg.encoding, 'GSM-7', `${key}: GSM-7 (${m.sms})`);
      assert.ok(seg.segments <= 2, `${key}: at most 2 texts (${seg.units} chars)`);
    }
    if (m.smsKind === 'marketing') assert.match(m.sms!, /Reply STOP to opt out/);
  }
  assert.equal(smsSegments(render('otp', { code: '000000' }).sms!).segments, 1);
  assert.equal(render('driver_on_way', { ...sample.driver_on_way, again: true }).title, 'New driver on the way');
  assert.equal(render('document_expiring', { label: 'Rego', days_left: -1 }).title, 'Rego has expired');
});

test('SMS length: GSM-7 vs UCS-2, extended characters count twice, typographic characters swapped', () => {
  assert.deepEqual(smsSegments('a'.repeat(160)), { encoding: 'GSM-7', units: 160, segments: 1 });
  assert.equal(smsSegments('a'.repeat(161)).segments, 2);
  assert.equal(smsSegments('[]'.repeat(40)).units, 160);
  assert.deepEqual(smsSegments('a'.repeat(69) + '—'), { encoding: 'UCS-2', units: 70, segments: 1 });
  assert.equal(smsSegments('a'.repeat(70) + '—').segments, 2);
  assert.equal(gsmFriendly('It’s here — “now”…'), 'It\'s here - "now"...');
  assert.equal(smsSegments(gsmFriendly('It’s here — now')).encoding, 'GSM-7');
});

test('opt-out keywords, phone numbers, Twilio signatures and TwiML escaping', () => {
  for (const s of ['STOP', ' stop ', 'Stop.', 'unsubscribe', 'STOP ALL', 'opt out', 'Cancel']) assert.equal(keyword(s), 'stop', s);
  assert.equal(keyword('start'), 'start');
  assert.equal(keyword('HELP'), 'help');
  for (const s of ['stop at the shops please', "I'm outside", 'yes', '']) assert.equal(keyword(s), null, s);
  assert.equal(e164('0412 345 678'), '+61412345678');
  assert.equal(e164('61412345678'), '+61412345678');
  const params = { From: '+61400000100', To: '+61480000000', Body: 'hi' };
  const sig = twilioSignature('tok', 'https://api.test/comms/twilio/sms', params);
  // HMAC-SHA1 over the URL and the sorted name+value pairs, base64.
  assert.equal(sig, crypto.createHmac('sha1', 'tok').update('https://api.test/comms/twilio/smsBodyhiFrom+61400000100To+61480000000').digest('base64'));
  assert.ok(checkTwilioSignature('tok', 'https://api.test/comms/twilio/sms', params, sig));
  assert.ok(!checkTwilioSignature('tok', 'https://api.test/comms/twilio/sms', { ...params, Body: 'hj' }, sig));
  assert.ok(!checkTwilioSignature('other', 'https://api.test/comms/twilio/sms', params, sig));
  assert.ok(!checkTwilioSignature('tok', 'https://api.test/comms/twilio/sms', params, undefined));
  assert.match(twiml.message('Fish & <chips>'), /<Message>Fish &amp; &lt;chips&gt;<\/Message>/);
  assert.match(twiml.dial('Connecting', '+61480000000', '+61400000011'), /<Dial callerId="\+61480000000"[^>]*><Number>\+61400000011<\/Number><\/Dial>/);
});

test('Web Push: payload encrypted per RFC 8291 can be decrypted by the browser keys; VAPID JWT is a valid ES256 signature', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = encryptWebPush(Buffer.from('{"title":"Hi"}'), ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decryptWebPush(body, ua, auth), '{"title":"Hi"}');

  const keys = generateVapidKeys();
  const prev = { ...config.push };
  Object.assign(config.push, { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey, vapidSubject: 'mailto:test@example.com' });
  try {
    const h = vapidAuthHeader('https://push.example.net/send/abc', 1_800_000_000);
    const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    assert.equal(m[4], keys.publicKey);
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    assert.deepEqual(claims, { aud: 'https://push.example.net', exp: 1_800_000_000 + 12 * 3600, sub: 'mailto:test@example.com' });
    const pub = Buffer.from(keys.publicKey, 'base64url');
    const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } as any });
    assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
  } finally { Object.assign(config.push, prev); }
});

test('notification settings: defaults, merge ignores junk, safety always on, offers need consent', () => {
  assert.deepEqual(mergePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(mergePrefs({ push: { trip: false, evil: true, chat: 'no' }, sms: { trip: true } }),
    { push: { ...DEFAULT_PREFS.push, trip: false }, sms: { trip: true } });
  const r = { id: 'x', phone: '+61400000100', name: 'A', marketing_opt_in: false, deleted: false, prefs: mergePrefs({ push: { trip: false } }) };
  assert.equal(pushAllowed(r, 'trip'), false);
  assert.equal(pushAllowed(r, 'safety'), true);
  assert.equal(pushAllowed(r, 'account'), true);
  assert.equal(pushAllowed(r, 'promo'), false, 'no consent, no offers');
  assert.equal(pushAllowed({ ...r, marketing_opt_in: true }, 'promo'), true);
  assert.equal(pushAllowed({ ...r, deleted: true }, 'safety'), false);
});
