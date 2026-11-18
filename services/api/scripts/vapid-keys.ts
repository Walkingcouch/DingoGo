/** Print a new VAPID key pair for Web Push: npm run vapid -w services/api */
import { generateVapidKeys } from '../src/services/push.js';

const k = generateVapidKeys();
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${k.publicKey}\nWEB_PUSH_VAPID_PRIVATE_KEY=${k.privateKey}\nWEB_PUSH_SUBJECT=mailto:support@dingogo.com.au`);
