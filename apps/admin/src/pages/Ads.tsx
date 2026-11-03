import { useState } from 'react';
import { get, patch, money, date, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, Section, Table, Tabs, exportCsv, useRun, type Field } from '../ui';

export function LedPreview({ headline, subline, bg, fg }: { headline?: string; subline?: string; bg?: string; fg?: string }) {
  return (
    <div style={{ containerType: 'inline-size' }}>
      <div className="ledpreview" style={{ background: bg || '#000', color: fg || '#fff' }} aria-label="Roof screen preview">
        <b>{headline || 'Headline'}</b>{subline && <span>{subline}</span>}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = { approved: 'green', pending: 'ochre', paused: '', ended: '', rejected: 'red' };

export default function Ads() {
  const [tab, setTab] = useState<'campaigns' | 'advertisers' | 'report'>('campaigns');
  const advertisers = useLoad(() => get('/admin/advertisers'));
  const setting = useLoad(() => get('/admin/settings'));
  const roof = setting.data?.items.find((s: any) => s.key === 'roof_display')?.value;
  const [k, setK] = useState(0);
  const run = useRun();
  const advOpts: [string, string][] = (advertisers.data?.items ?? []).map((a: any) => [a.id, a.name]);
  const fields: Field[] = [
    { key: 'advertiser_id', label: 'Advertiser', type: 'select', required: true, options: advOpts }, { key: 'name', label: 'Campaign name', required: true },
    { key: 'headline', label: 'Headline (short, readable from a footpath)', required: true, full: true }, { key: 'subline', label: 'Second line', full: true },
    { key: 'bg_colour', label: 'Background colour', type: 'color' }, { key: 'fg_colour', label: 'Text colour', type: 'color' },
    { key: 'starts_on', label: 'Starts', type: 'date', required: true }, { key: 'ends_on', label: 'Ends', type: 'date', required: true },
    { key: 'hour_from', label: 'Show from hour (0 to 23)', type: 'number', min: 0, max: 23 }, { key: 'hour_to', label: 'Until hour (1 to 24)', type: 'number', min: 1, max: 24 },
    { key: 'geo_lat', label: 'Only near latitude', type: 'number', step: 0.0001 }, { key: 'geo_lng', label: 'Only near longitude', type: 'number', step: 0.0001 },
    { key: 'geo_radius_m', label: 'Within metres', type: 'number' }, { key: 'weight', label: 'Share of airtime (weight)', type: 'number', min: 1 },
    { key: 'cpm_cents', label: 'Price per 1,000 plays', type: 'money' }, { key: 'budget_cents', label: 'Budget cap', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: [['pending', 'Pending review'], ['approved', 'Approved (on air)'], ['paused', 'Paused'], ['ended', 'Ended'], ['rejected', 'Rejected']] },
  ];
  return (
    <Page title="Roof advertising">
      <div className="dg-note" style={{ marginBottom: 16, borderLeft: '4px solid var(--ochre)' }}>
        <strong>Screens are currently {roof?.mode === 'off' ? 'switched off' : 'showing ads'}.</strong> {roof?.note ?? 'NT rules say rideshare vehicles must not carry signage that makes them look available for hire. Get written approval before using roof screens in service.'}
        {' '}Screens never show availability messages. Change this in Settings.
      </div>
      <Tabs tabs={[['campaigns', 'Campaigns'], ['advertisers', 'Advertisers'], ['report', 'Plays & billing']]} value={tab} onChange={setTab} />
      {tab === 'campaigns' && <CrudSection key={k} title="Campaigns" path="campaigns" newLabel="New campaign" fields={fields}
        preview={(f) => <div style={{ marginBottom: 12 }}><LedPreview headline={f.headline} subline={f.subline} bg={f.bg_colour} fg={f.fg_colour} /></div>}
        cols={[
          { key: 'preview', label: 'Screen', render: (c) => <div style={{ width: 180 }}><LedPreview headline={c.headline} subline={c.subline} bg={c.bg_colour} fg={c.fg_colour} /></div> },
          { key: 'name', label: 'Campaign', render: (c) => <><strong>{c.name}</strong><br /><span className="dg-muted" style={{ fontSize: '.85rem' }}>{advOpts.find(([id]) => id === c.advertiser_id)?.[1]}</span></> },
          { key: 'dates', label: 'Runs', render: (c) => <>{date(c.starts_on)} to {date(c.ends_on)}<br /><span className="dg-muted" style={{ fontSize: '.85rem' }}>{c.hour_from}:00 to {c.hour_to}:00{c.geo_radius_m ? `, within ${c.geo_radius_m} m` : ''}</span></> },
          { key: 'cpm_cents', label: 'Per 1,000', num: true, render: (c) => (c.cpm_cents ? money(c.cpm_cents) : 'Free') },
          { key: 'status', label: 'Status', render: (c) => <Chip tone={STATUS_TONE[c.status]}>{c.status}</Chip> },
          { key: 'x', label: '', render: (c) => (
            <span onClick={(e) => e.stopPropagation()}>
              {c.status !== 'approved' && <button className="dg-btn dg-btn--sm dg-btn--green" onClick={async () => { await run(() => patch(`/admin/campaigns/${c.id}`, { status: 'approved' }), 'Campaign approved'); setK(k + 1); }}>Approve</button>}
              {c.status === 'approved' && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { await run(() => patch(`/admin/campaigns/${c.id}`, { status: 'paused' }), 'Campaign paused'); setK(k + 1); }}>Pause</button>}
            </span>) },
        ]} />}
      {tab === 'advertisers' && <CrudSection title="Advertisers" path="advertisers" newLabel="Add advertiser" fields={[
        { key: 'name', label: 'Business name', required: true }, { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'abn', label: 'ABN' }, { key: 'community', label: 'Community message (free airtime)', type: 'bool' },
      ]} cols={[{ key: 'name', label: 'Advertiser', render: (a) => <strong>{a.name}</strong> }, { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
        { key: 'community', label: '', render: (a) => a.community && <Chip tone="green">Community</Chip> }]} />}
      {tab === 'report' && <Report />}
    </Page>
  );
}

function Report() {
  const { data } = useLoad(() => get('/admin/campaigns-report'));
  const cols = [
    { key: 'name', label: 'Campaign' }, { key: 'advertiser', label: 'Advertiser' }, { key: 'status', label: 'Status' },
    { key: 'plays', label: 'Plays', num: true }, { key: 'seconds', label: 'Seconds on air', num: true }, { key: 'vehicles', label: 'Vehicles', num: true },
    { key: 'billable_cents', label: 'Billable', num: true, render: (r: any) => money(r.billable_cents), csv: (r: any) => (r.billable_cents / 100).toFixed(2) },
    { key: 'budget_cents', label: 'Budget', num: true, render: (r: any) => (r.budget_cents ? money(r.budget_cents) : '—') },
  ];
  return (<>
    <Section title="Plays and billing" right={data && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv('ad-plays.csv', data.items, cols)}>Export CSV</button>} />
    <Table rows={data?.items} cols={cols} />
  </>);
}
