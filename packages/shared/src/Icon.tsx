/**
 * DingoGo icon set — one consistent 24px line style (2px stroke, round joins) for every app.
 * Use instead of emoji: <Icon name="car" /> . Decorative by default; pass `label` to make it meaningful to screen readers.
 */
import type { CSSProperties } from 'react';

const P: Record<string, string> = {
  car: 'M5 17H3v-4.5L5.2 7.4A2 2 0 0 1 7 6h10a2 2 0 0 1 1.8 1.4L21 12.5V17h-2M3 12.5h18M9 17h6M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  paw: 'M12 21c-2.8 0-5.5-1.4-5.5-3.6 0-2.7 3-5.4 5.5-5.4s5.5 2.7 5.5 5.4c0 2.2-2.7 3.6-5.5 3.6zM3.2 10.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0M17.2 10.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0M7.2 5.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0M13.2 5.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0',
  package: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3a2 2 0 0 0 0 4M12 7s1.5-4 4-4a2 2 0 0 1 0 4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  home: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4',
  wallet: 'M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v3M16 13.5h.01',
  coffee: 'M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3',
  shield: 'M12 21s8-3.5 8-10V5l-8-3-8 3v6c0 6.5 8 10 8 10zM9 12l2 2 4-4',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  chat: 'M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.3A8 8 0 1 1 21 12z',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 5 5 9-10',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  battery: 'M3 8h15v8H3zM21 11v2M6 11v2M9 11v2',
  leaf: 'M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19c3-4 6-6 9-7',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  swap: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  access: 'M10.2 4.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0M5 9h14M12 9v5M8 21l4-7 4 7',
  sos: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01',
  route: 'M4 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M16 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M6 17V10a3 3 0 0 1 3-3h4M18 7v7a3 3 0 0 1-3 3h-4',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  document: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  pen: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  navigation: 'M3 11 21 3l-8 18-2-8z',
  power: 'M12 2v10M5.6 6.6a8 8 0 1 0 12.8 0',
  ticket: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10',
};

export type IconName = keyof typeof P;
export const ICONS = Object.keys(P) as IconName[];

export function Icon({ name, size = 20, label, strokeWidth = 2, style, className }: {
  name: IconName | string; size?: number; label?: string; strokeWidth?: number; style?: CSSProperties; className?: string;
}) {
  const d = P[name] ?? P.info;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle', ...style }}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} />
    </svg>
  );
}

/** Service code → icon, used by every app instead of emoji. */
export const SERVICE_ICON_NAME: Record<string, IconName> = {
  ride: 'car', pet: 'paw', courier_s: 'package', courier_m: 'package', courier_l: 'package', tour: 'compass', hourly: 'calendar',
};
