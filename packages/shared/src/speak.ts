/** Read words out loud (simple mode, read-out offers). Australian English voice when the phone has one. Never throws. */
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export function speak(text: string, opts: { interrupt?: boolean; rate?: number } = {}) {
  if (!canSpeak() || !text) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-AU';
    u.rate = opts.rate ?? 0.95;
    const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-AU') ?? speechSynthesis.getVoices().find((v) => v.lang?.startsWith('en'));
    if (voice) u.voice = voice;
    if (opts.interrupt !== false) speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}
