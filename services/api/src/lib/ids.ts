import { customAlphabet } from 'nanoid';
import crypto from 'node:crypto';

const upper = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);
const digits = customAlphabet('0123456789', 4);
const token = customAlphabet('23456789abcdefghijkmnpqrstuvwxyz', 20);

export const tripRef = () => `DG-${upper()}`;
export const pin4 = () => digits();
export const shareToken = () => token();
export const referralCode = (name: string) =>
  `${(name.replace(/[^a-z]/gi, '').slice(0, 5) || 'DINGO').toUpperCase()}${upper().slice(0, 4)}`;
export const voucherCode = () => `DG${upper()}`;
export const displayKey = () => `led_${token()}${token()}`;
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
