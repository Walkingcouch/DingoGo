/**
 * Round 13 — website growth: the driver recruitment funnel (stages an applicant can see through a private link) and the public
 * referral-code check. Live-DB lag: the 018 columns may not exist yet; `applicationsReady()` says so and the old form keeps working.
 */
import { one } from '../db.js';

/** Stages in the order an applicant moves through them. The first four keys were the admin's free-text statuses before Round 13. */
export const APPLICATION_STAGES = {
  new: { label: 'Received', detail: 'We have your details. Someone from DingoGo will call you within a few days.' },
  contacted: { label: "We've called", detail: "We've had a first yarn. Next we'll help you start on the NT paperwork." },
  onboarding: { label: 'Paperwork', detail: 'You are getting your H endorsement, police check, medical, ABN and your car licensed. Ask us any time.' },
  approved: { label: 'Approved', detail: 'You can drive with DingoGo. Download the driver app and sign in with the mobile you applied with.' },
  declined: { label: 'Not right now', detail: "We can't take your application forward at the moment. The note below says why, and you're welcome to apply again later." },
  withdrawn: { label: 'Withdrawn', detail: 'You withdrew this application. Apply again any time.' },
} as const;
export type ApplicationStage = keyof typeof APPLICATION_STAGES;
export const STAGE_KEYS = Object.keys(APPLICATION_STAGES) as [ApplicationStage, ...ApplicationStage[]];
/** The path shown as steps on the status page; the last step is replaced by "Not right now"/"Withdrawn" when it ends that way. */
const PATH: ApplicationStage[] = ['new', 'contacted', 'onboarding', 'approved'];
export const FINAL_STAGES: ApplicationStage[] = ['approved', 'declined', 'withdrawn'];

export const STATUS_TOKEN = /^[a-z0-9]{20}$/;
export const REFERRAL_CODE = /^[A-Z0-9]{4,12}$/i;

/** Source of an application: a short label like "facebook / driver-ad" from utm tags, or a referrer host. */
export const cleanSource = (s: string | undefined | null) => {
  const v = (s ?? '').toLowerCase().replace(/[^a-z0-9 ./_-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return v || null;
};

export function applicationSteps(stage: string) {
  const s = (stage in APPLICATION_STAGES ? stage : 'new') as ApplicationStage;
  const at = s === 'declined' || s === 'withdrawn' ? -1 : PATH.indexOf(s);
  const steps = PATH.map((k, i) => ({ key: k, label: APPLICATION_STAGES[k].label, done: at >= 0 && i < at, current: i === at }));
  if (at < 0) steps.splice(steps.length - 1, 1, { key: s, label: APPLICATION_STAGES[s].label, done: false, current: true });
  return steps;
}

/** What the private status link shows: no phone, email or message — only the first name, the stage and the team's note. */
export function publicApplication(row: any) {
  const stage = (row.status in APPLICATION_STAGES ? row.status : 'new') as ApplicationStage;
  return {
    ref: row.ref, first_name: String(row.name ?? '').trim().split(/\s+/)[0] ?? '', stage,
    stage_label: APPLICATION_STAGES[stage].label, stage_detail: APPLICATION_STAGES[stage].detail,
    steps: applicationSteps(stage), note: row.public_note ?? null, drive_state: row.drive_state ?? 'NT',
    received_at: row.created_at, updated_at: row.updated_at ?? row.created_at,
    can_withdraw: !FINAL_STAGES.includes(stage),
  };
}

let ready = false;
let checkedAt = 0;
export async function applicationsReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'driver_applications'
         AND column_name IN ('ref', 'status_token', 'public_note', 'source', 'drive_state', 'updated_at')`);
    ready = r!.n === 6;
  } catch { ready = false; }
  return ready;
}
export function resetApplicationsReady() { ready = false; checkedAt = 0; }
export const applicationsPending = () => 'Application status links need database migration 018';
