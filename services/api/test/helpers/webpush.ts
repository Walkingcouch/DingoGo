import crypto from 'node:crypto';
import assert from 'node:assert/strict';

/** What a browser does with an aes128gcm Web Push message (RFC 8291), to prove ours can be read. */
export function decryptWebPush(body: Buffer, ua: crypto.ECDH, auth: Buffer) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const as = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(as);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

