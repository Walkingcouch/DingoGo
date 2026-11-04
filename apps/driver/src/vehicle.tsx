import { Icon } from '@dingogo/shared';

/** Fuel types the API accepts, in the order drivers see them. Electric and hybrids are "green" and get offered trips first. */
export const FUELS: [string, string][] = [
  ['electric', 'Electric'], ['plug_in_hybrid', 'Plug-in hybrid'], ['hybrid', 'Hybrid'], ['petrol', 'Petrol'], ['diesel', 'Diesel'],
];
export const FUEL_LABEL: Record<string, string> = Object.fromEntries(FUELS);
const GREEN = ['electric', 'plug_in_hybrid', 'hybrid'];

// Older API responses have no fuel_type; every car on the road before own-car drivers was electric.
const fuel = (v: any) => (v?.fuel_type ?? 'electric') as string;
/** Fully electric: battery bar, range, low-charge check. */
export const isEv = (v: any) => !!v && (v.is_ev ?? fuel(v) === 'electric');
/** Has a plug (electric or plug-in hybrid): charging log and battery check-ins make sense. */
export const hasPlug = (v: any) => !!v && (isEv(v) || fuel(v) === 'plug_in_hybrid');
export const isGreen = (v: any) => !!v && (v.green ?? GREEN.includes(fuel(v)));

export function FuelChip({ v }: { v: any }) {
  if (!v) return null;
  const g = isGreen(v);
  return <span className={'dg-chip' + (g ? ' dg-chip--green' : '')}>{g && <Icon name={isEv(v) ? 'bolt' : 'leaf'} size={14} />}{FUEL_LABEL[fuel(v)] ?? fuel(v)}</span>;
}

/** Waiting for check / Approved / Not approved. Fleet cars predate review and count as approved. */
export function CarStatus({ v }: { v: any }) {
  const s = v?.status ?? 'approved';
  if (s === 'pending') return <span className="dg-chip dg-chip--ochre"><Icon name="clock" size={14} />Waiting for check</span>;
  if (s === 'rejected') return <span className="dg-chip dg-chip--red"><Icon name="x" size={14} />Not approved</span>;
  return <span className="dg-chip dg-chip--green"><Icon name="check" size={14} />Approved</span>;
}

export const carName = (v: any) => [v.year, v.make, v.model].filter(Boolean).join(' ');
export const minYearFallback = () => new Date().getFullYear() - 12;
