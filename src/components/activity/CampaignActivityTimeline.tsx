'use client';

import { useEffect, useState } from 'react';
import {
  fetchActivityForCampaign,
  type ActivityEvent,
} from '@/lib/activity-log';

const ACTION_ICONS: Record<string, string> = {
  'campaign.sent_for_approval': '📤',
  'campaign.status_changed': '🔄',
  'campaign.arcon_updated': '📋',
  'campaign.plan_approved': '✅',
  'booking.requested': '📋',
  'booking.added_to_plan': '➕',
  'booking.removed_from_plan': '➖',
  'booking.rate_updated': '💰',
  'booking.status_changed': '🔄',
  'booking.approved_by_client': '✅',
  'booking.declined_by_client': '✕',
  'booking.mpo_raised': '📄',
  'booking.message_sent': '💬',
  'compliance.submitted': '📸',
  'compliance.verified': '✅',
  'compliance.flagged': '⚠️',
  'invoice.created': '🧾',
  'invoice.compiled': '🧾',
  'invoice.paid': '💰',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

type Props = {
  campaignId: string;
  refreshKey?: number;
};

export default function CampaignActivityTimeline({ campaignId, refreshKey = 0 }: Props) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchActivityForCampaign(campaignId);
      if (!cancelled) {
        setEvents(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, refreshKey]);

  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: 20 }}>
      <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 16px' }}>
        Activity log
      </h2>
      {loading ? (
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
          No activity recorded yet. Actions on this campaign, its bookings, and invoices will appear here.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {events.map((ev, i) => (
            <div
              key={ev.id}
              style={{
                display: 'flex', gap: 10, padding: '10px 0',
                borderBottom: i < events.length - 1 ? '1px solid #F1F5F9' : 'none',
              }}
            >
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>{ACTION_ICONS[ev.action] || '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: '0 0 2px', lineHeight: 1.4 }}>
                  {ev.summary}
                </p>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                  {ev.actor_name || ev.actor_role || 'System'} · {fmtTime(ev.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
