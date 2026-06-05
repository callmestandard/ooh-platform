'use client';

import { useEffect, useState } from 'react';
import {
  fetchActivityForEntity,
  type ActivityEntityType,
  type ActivityEvent,
} from '@/lib/activity-log';

const ACTION_ICONS: Record<string, string> = {
  'invoice.updated': '📝',
  'invoice.cancelled': '✕',
  'invoice.compiled': '🧾',
  'invoice.paid': '💰',
  'invoice.mpi_updated': '📄',
  'invoice.mpi_created': '📄',
  'compliance.verified': '✅',
  'compliance.flagged': '⚠️',
  'compliance.submitted': '📸',
  'booking.requested': '📋',
  'booking.mpo_raised': '📄',
  'booking.status_changed': '🔄',
  'booking.message_sent': '💬',
  'booking.added_to_plan': '➕',
  'booking.removed_from_plan': '➖',
  'booking.rate_updated': '💰',
  'booking.approved_by_client': '✅',
  'booking.declined_by_client': '✕',
  'campaign.sent_for_approval': '📤',
  'campaign.arcon_updated': '📋',
  'campaign.status_changed': '🔄',
  'invoice.created': '🧾',
  'invoice.erp_exported': '📤',
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

type Props = {
  entityType: ActivityEntityType;
  entityId: string;
  title?: string;
  refreshKey?: number;
};

export default function ActivityTimeline({ entityType, entityId, title = 'Activity log', refreshKey = 0 }: Props) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchActivityForEntity(entityType, entityId);
      if (!cancelled) {
        setEvents(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entityType, entityId, refreshKey]);

  if (loading) {
    return (
      <div style={{ padding: '16px 0', fontSize: '0.8125rem', color: '#94A3B8' }}>
        Loading activity…
      </div>
    );
  }

  if (events.length === 0) return null;

  return (
    <div style={{
      background: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9',
      padding: '16px', marginTop: 20,
    }}>
      <p style={{
        fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8',
        textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px',
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {events.map((ev, i) => (
          <div
            key={ev.id}
            style={{
              display: 'flex', gap: 10, padding: '10px 0',
              borderBottom: i < events.length - 1 ? '1px solid #E2E8F0' : 'none',
            }}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1.2, flexShrink: 0 }}>
              {ACTION_ICONS[ev.action] || '•'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: '0 0 2px', lineHeight: 1.4 }}>
                {ev.summary}
              </p>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                {ev.actor_name || ev.actor_role || 'System'}
                {' · '}
                {fmtTime(ev.created_at)}
              </p>
              {ev.changes && Object.keys(ev.changes).length > 0 && (
                <div style={{ marginTop: 6, fontSize: '0.6875rem', color: '#64748B' }}>
                  {Object.entries(ev.changes).map(([field, ch]) => (
                    <div key={field}>
                      <span style={{ fontWeight: 600 }}>{field}</span>
                      {': '}
                      <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {String(ch.from ?? '—')} → {String(ch.to ?? '—')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
