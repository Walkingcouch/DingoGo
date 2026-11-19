/**
 * Round 21: app store readiness — Android App Links (Digital Asset Links) and permission disclosures. Pure; no database.
 */

/** Certificate of the public TEST signing key (android-signing/dingogo-test.keystore). Anyone can sign an app with it, so it
 *  is never listed in assetlinks.json: otherwise any app could claim DingoGo's share-trip links (they show home addresses). */
export const TEST_KEY_SHA256 = 'C5:C8:FE:E0:A1:7C:DF:1D:4B:00:53:CF:0F:0C:33:B4:20:BF:6F:7F:34:85:99:C3:BB:E9:CA:64:6A:1C:E7:20';
export const RIDER_PACKAGE = 'au.com.dingogo.rider';
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** "AA:BB:…" fingerprints from ANDROID_APP_LINK_CERTS (comma or space separated; colons optional; any case). Bad entries and the
 *  public test key are dropped and reported so a typo is visible in the logs rather than silently breaking verification. */
export function parseCertList(raw: string | undefined | null): { certs: string[]; rejected: string[] } {
  const certs: string[] = []; const rejected: string[] = [];
  for (const part of String(raw ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const hex = part.replace(/:/g, '').toUpperCase();
    const fp = /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g)!.join(':') : part.toUpperCase();
    if (!FINGERPRINT.test(fp) || fp === TEST_KEY_SHA256) rejected.push(part);
    else if (!certs.includes(fp)) certs.push(fp);
  }
  return { certs, rejected };
}

/** The Digital Asset Links statement Android checks before opening https://<site>/track/… and /rider/… links in the app. */
export function assetLinks(pkg: string, certs: string[]) {
  if (!certs.length) return [];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: certs },
  }];
}

export const DISCLOSURE_KINDS = ['location', 'background_location', 'notifications', 'camera'] as const;
export const DISCLOSURE_APPS = ['rider', 'driver'] as const;
export const DISCLOSURE_PLATFORMS = ['android', 'ios', 'web'] as const;
