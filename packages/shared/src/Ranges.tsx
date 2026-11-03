/** The MacDonnell Ranges horizon — DingoGo's signature line. Decorative; hidden from screen readers. */
export function Ranges({ height = 64, fill = 'currentColor', className, style }: { height?: number; fill?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg aria-hidden="true" className={className} style={{ display: 'block', width: '100%', height, ...style }} viewBox="0 0 1200 100" preserveAspectRatio="none">
      <path fill={fill} d="M0 100 L0 70 C40 66 70 58 105 60 C135 62 150 50 180 47 C210 44 228 56 262 58 C290 60 310 40 345 36 C372 33 392 46 420 52
        C452 59 470 63 505 55 C540 47 560 30 600 28 C640 26 655 44 690 50 C720 55 745 49 770 42 C800 34 825 38 850 47 C880 58 905 62 940 57
        C975 52 990 41 1025 40 C1060 39 1080 52 1110 56 C1140 60 1170 58 1200 55 L1200 100 Z"/>
    </svg>
  );
}
