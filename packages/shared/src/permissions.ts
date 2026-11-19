/**
 * Round 21: what the apps tell people before the phone asks for a permission (Google Play's "prominent disclosure"), and the
 * answer. Shown in the app's normal flow, before the system prompt, with Continue / Not now. The answer is kept on this phone
 * (so it isn't asked again) and recorded with DingoGo (POST /me/disclosures) with the wording version, so a change to the
 * wording asks again. Never blocks: if DingoGo can't be reached the answer still counts on the phone.
 */
import { post } from './api';

export type DisclosureKind = 'location' | 'notifications' | 'camera';
export type DisclosureApp = 'rider' | 'driver';
export interface Disclosure {
  app: DisclosureApp; kind: DisclosureKind; version: string;
  title: string; lead: string; points: string[]; notes: string[]; accept: string; decline: string;
}

/** Wording. Change the version whenever the meaning changes (people are asked again). */
export const DISCLOSURES = {
  driverLocation: {
    app: 'driver', kind: 'location', version: '2026-11-location-1',
    title: 'Your location while you drive',
    lead: 'DingoGo Driver collects your location to:',
    points: [
      'offer you trips near you',
      'show your rider, and anyone they share the trip with, where your car is',
      'record the route for the fare, your pay and any safety report',
    ],
    notes: [
      'Only while the app is open. It is sent to DingoGo while you are online or on a trip; when you are offline it stays on your phone for the map.',
      'Shared with your rider during their trip. Never sold or used for ads.',
      'Next, your phone asks to allow location. Choose "While using the app".',
    ],
    accept: 'Continue', decline: 'Not now',
  },
  driverNotifications: {
    app: 'driver', kind: 'notifications', version: '2026-11-notify-1',
    title: 'Trip offers when the app is in the background',
    lead: 'Notifications tell you about:',
    points: ['a new trip offer', 'a message from your rider', 'papers about to expire and pay updates'],
    notes: ['You choose which ones in Profile, Notifications. Next, your phone asks to allow notifications.'],
    accept: 'Turn on notifications', decline: 'Not now',
  },
} satisfies Record<string, Disclosure>;

const KEY = (app: string, kind: string) => `dingogo.${app}.disclosure.${kind}`;
export interface DisclosureAnswer { version: string; accepted: boolean; at: string }

/** This phone's answer to the current wording (an answer to older wording counts as no answer). */
export function disclosureAnswer(d: Disclosure): DisclosureAnswer | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY(d.app, d.kind)) ?? 'null') as DisclosureAnswer | null;
    return a && a.version === d.version ? a : null;
  } catch { return null; }
}

export function appPlatform(): 'android' | 'ios' | 'web' {
  const c = typeof window !== 'undefined' ? (window as any).Capacitor : undefined;
  const p = c?.isNativePlatform?.() ? c.getPlatform?.() : 'web';
  return p === 'android' || p === 'ios' ? p : 'web';
}

/** The app's version (set by the build, e.g. "1.1.0 (57)"). */
export const appVersion = (): string => ((import.meta as any).env?.VITE_APP_VERSION as string | undefined) || 'dev';

/** Keep the answer on this phone and record it with DingoGo (best effort, never throws). */
export function answerDisclosure(d: Disclosure, accepted: boolean) {
  const a: DisclosureAnswer = { version: d.version, accepted, at: new Date().toISOString() };
  try { localStorage.setItem(KEY(d.app, d.kind), JSON.stringify(a)); } catch { /* storage off: asked again next time */ }
  void post('/me/disclosures', { app: d.app, kind: d.kind, version: d.version, accepted, platform: appPlatform(), app_version: appVersion() },
    { timeoutMs: 8000 }).catch(() => undefined);
  return a;
}
