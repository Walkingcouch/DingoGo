import { createContext, useContext } from 'react';

export interface Me {
  user: { id: string; name: string; phone: string; email: string | null; loyalty_points: number; wallet_cents: number; referral_code: string;
    marketing_opt_in: boolean; language: string; accessibility: Record<string, any>; emergency_contact: { name: string; phone: string } | null; rating_avg: number | null };
  subscription: any | null;
  corporate_accounts: { id: string; name: string; role: string }[];
}
export const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void>; signOut: () => void }>({ me: null, reload: async () => {}, signOut: () => {} });
export const useMe = () => useContext(MeCtx);

const env = (import.meta as any).env ?? {};
export const WEB_URL: string = (env.VITE_WEB_URL || (typeof location !== 'undefined' ? location.origin : 'http://localhost:5173')).replace(/\/$/, '');
export const shareUrl = (token: string) => `${WEB_URL}/track/${token}`;
export const ACTIVE = ['requested', 'accepted', 'arrived', 'in_progress'];
