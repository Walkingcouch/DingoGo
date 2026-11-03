import { createContext, useContext, useEffect, useState } from 'react';
import { get } from '@dingogo/shared';

export type FareRule = { service: string; label: string; base_cents: number; per_km_cents: number; per_min_cents: number; booking_fee_cents: number; min_fare_cents: number; cancel_fee_cents: number; free_wait_min: number; night_pct: number; levy_cents: number; description: string };
export type PublicConfig = {
  services: FareRule[];
  zones: { id: string; name: string; active: boolean; launch_note: string }[];
  plans: { code: string; name: string; price_cents: number; perks: string[] }[];
  business: { name?: string; email?: string; owners?: string; abn?: string };
  support: { phone?: string; email?: string; hours?: string };
};

const Ctx = createContext<PublicConfig | null>(null);
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  useEffect(() => { get<PublicConfig>('/public/config').then(setCfg).catch(() => setCfg(null)); }, []);
  return <Ctx.Provider value={cfg}>{children}</Ctx.Provider>;
}
export const useConfig = () => useContext(Ctx);
export const rule = (cfg: PublicConfig | null, s: string) => cfg?.services.find((r) => r.service === s);
/** Contact details fall back to the business plan's published contact if the API is unreachable. */
export const contact = (cfg: PublicConfig | null) => ({
  phone: cfg?.support.phone ?? '0432 101 175',
  email: cfg?.support.email ?? 'contact@aperrke.com.au',
  hours: cfg?.support.hours ?? '6am to midnight, 7 days',
});
