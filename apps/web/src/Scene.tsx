/**
 * Art-directed Central Australian landscapes, drawn in SVG (no photos).
 * The hero uses the full dusk scene; tours and page heads use smaller variants.
 */
import { useId } from 'react';

export type SceneTone = 'dusk' | 'dawn' | 'noon' | 'gap' | 'night';

const SKIES: Record<SceneTone, [string, string, string, string]> = {
  //            top        upper       lower       horizon glow
  dusk:  ['#0E1830', '#22325A', '#6B4F7E', '#E08A3C'],
  dawn:  ['#2B3A67', '#7E6A9A', '#E7A77A', '#F6D3A1'],
  noon:  ['#2F6FA8', '#5E9CCB', '#A9CBE3', '#F1E2C6'],
  gap:   ['#3A2A4F', '#8C4B4B', '#D9773B', '#F2B25C'],
  night: ['#0B1428', '#14213D', '#22325A', '#3A3F6B'],
};
const RIDGES: Record<SceneTone, [string, string, string]> = {
  dusk:  ['#5B4A7A', '#3B2F58', '#A63D2A'],
  dawn:  ['#8C7AA6', '#6A4F72', '#B5562F'],
  noon:  ['#B9855C', '#9A5A36', '#A63D2A'],
  gap:   ['#7B4A55', '#5A2F3A', '#8E3522'],
  night: ['#2C3A63', '#1E2A4B', '#14213D'],
};

// Ridge silhouettes on a 1440 × 400 canvas. Far ridge is long and low; near ridge is the MacDonnells' broken line.
const FAR = 'M0 250 C120 238 210 222 320 226 C430 230 500 212 610 206 C720 200 800 220 905 214 C1010 208 1090 190 1200 196 C1310 202 1380 214 1440 210 L1440 400 L0 400 Z';
const MID = 'M0 290 C90 280 150 262 230 260 C300 258 330 276 400 272 C470 268 520 244 600 240 C680 236 720 262 800 266 C880 270 940 248 1020 244 C1100 240 1150 264 1230 268 C1310 272 1380 258 1440 252 L1440 400 L0 400 Z';
const NEAR = 'M0 330 C70 322 120 306 190 302 C250 298 290 318 350 320 C420 322 470 300 540 296 C600 292 650 310 700 314 L760 312 C820 308 880 290 950 288 C1020 286 1070 306 1130 310 C1200 314 1260 300 1330 296 C1380 293 1420 300 1440 302 L1440 400 L0 400 Z';
// A gap version of the near ridge (for Simpsons / Emily Gap tours): a notch cut in the middle.
const NEAR_GAP = 'M0 320 C90 312 170 290 260 282 C350 274 420 280 520 268 C590 260 640 250 680 252 L700 320 L740 320 L760 250 C800 246 860 258 940 266 C1040 276 1120 272 1220 284 C1320 296 1400 304 1440 306 L1440 400 L0 400 Z';

const STARS = [[90, 40, 1.4], [210, 92, 1], [330, 28, 1.2], [470, 70, .9], [610, 34, 1.5], [800, 88, 1], [880, 22, 1.1], [1010, 64, 1.4], [1150, 30, .9], [1290, 78, 1.2], [1390, 40, 1], [940, 120, .8], [1240, 140, .8], [1100, 150, .7], [860, 160, .9], [1370, 110, .8]];

export function Scene({ tone = 'dusk', height, className, stars, sun = true, gap = false, ground = 'var(--bg)', style }: {
  tone?: SceneTone; height?: number | string; className?: string; stars?: boolean | 'right'; sun?: boolean; gap?: boolean; ground?: string; style?: React.CSSProperties;
}) {
  const id = useId().replace(/:/g, '');
  const [s0, s1, s2, s3] = SKIES[tone];
  const [far, mid, near] = RIDGES[tone];
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 1440 400" preserveAspectRatio="xMidYMax slice"
      style={{ display: 'block', width: '100%', height: height ?? '100%', ...style }}>
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s0} /><stop offset=".45" stopColor={s1} /><stop offset=".78" stopColor={s2} /><stop offset="1" stopColor={s3} />
        </linearGradient>
        <radialGradient id={`sun${id}`} cx=".68" cy=".72" r=".42">
          <stop offset="0" stopColor={s3} stopOpacity=".95" /><stop offset=".35" stopColor={s3} stopOpacity=".35" /><stop offset="1" stopColor={s3} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="400" fill={`url(#sky${id})`} />
      {sun && <rect width="1440" height="400" fill={`url(#sun${id})`} />}
      {stars && (
        <g fill="#fff">
          {STARS.filter(([x]) => stars === 'right' ? x > 780 : true).map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} opacity={i % 3 ? .55 : .85} />
          ))}
        </g>
      )}
      <path d={FAR} fill={far} />
      <path d={MID} fill={mid} />
      <path d={gap ? NEAR_GAP : NEAR} fill={near} />
      <path d="M0 372 C200 362 380 368 560 364 C760 360 940 370 1120 366 C1270 363 1380 366 1440 364 L1440 400 L0 400 Z" fill={ground} />
    </svg>
  );
}
