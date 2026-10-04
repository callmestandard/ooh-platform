'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import { logActivity, getActivityActor } from '@/lib/activity-log';
import ActivityTimeline from '@/components/activity/ActivityTimeline';
import {
  type PrintTask, type ResponsibleParty,
  PRINT_STATUS_ORDER, PRINT_STATUS_LABELS, PRINT_STATUS_STYLE, RESPONSIBLE_PARTY_LABELS,
  fetchPrintTask, createPrintTask, updatePrintTask, reassignPrintTaskParty,
  resolveBoardOwnership, canActOnPrintTask, nextPrintStatus, uploadPrintPhoto,
} from '@/lib/print-tasks';

type Props = {
  bookingId: string;
  campaignId: string;
  boardId: string;
  boardName: string;
  campaignAgencyId: string | null;
  campaignClientId: string | null;
  onClose: () => void;
  onChange?: (task: PrintTask | null) => void;
};

export default function PrintStatusPanel({
  bookingId, campaignId, boardId, boardName, campaignAgencyId, campaignClientId, onClose, onChange,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<PrintTask | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [boardOwnerMatches, setBoardOwnerMatches] = useState(false);
  const [boardHasVerifiedOwner, setBoardHasVerifiedOwner] = useState(false);
  const [newParty, setNewParty] = useState<ResponsibleParty | ''>('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [profile, existing, ownership] = await Promise.all([
        getCurrentProfile(),
        fetchPrintTask(bookingId),
        resolveBoardOwnership(boardId),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setRole(profile?.role ?? null);
      setUserId(session?.user?.id ?? null);
      setTask(existing);
      setNotes(existing?.notes ?? '');
      setBoardHasVerifiedOwner(ownership.hasVerifiedOwner);
      setBoardOwnerMatches(session?.user?.id ? ownership.matchesUid(session.user.id) : false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bookingId, boardId]);

  const canAct = task ? canActOnPrintTask(task, {
    role, userId, campaignAgencyId, campaignClientId,
    boardOwnerMatches, boardHasVerifiedOwner,
  }) : false;
  const canManage = role === 'agency' || role === 'admin';

  async function handleCreate() {
    if (!newParty) return;
    setSaving(true);
    setError(null);
    const created = await createPrintTask({ bookingId, campaignId, responsibleParty: newParty });
    if (!created) { setError('Failed to set up print tracking'); setSaving(false); return; }
    const actor = await getActivityActor();
    await logActivity({
      entityType: 'print_task', entityId: created.id, campaignId,
      action: 'print_task.created',
      summary: `Print tracking set up for ${boardName} — ${RESPONSIBLE_PARTY_LABELS[newParty]} responsible`,
      ...actor,
    });
    setTask(created);
    setRefreshKey(k => k + 1);
    onChange?.(created);
    setSaving(false);
  }

  async function handleReassign(party: ResponsibleParty) {
    if (!task) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await reassignPrintTaskParty(task.id, party);
    if (err || !data) { setError(err || 'Failed to reassign'); setSaving(false); return; }
    const actor = await getActivityActor();
    await logActivity({
      entityType: 'print_task', entityId: task.id, campaignId,
      action: 'print_task.status_changed',
      summary: `${boardName} print responsibility reassigned to ${RESPONSIBLE_PARTY_LABELS[party]}`,
      ...actor,
      changes: { responsible_party: { from: task.responsible_party, to: party } },
    });
    setTask(data);
    setRefreshKey(k => k + 1);
    onChange?.(data);
    setSaving(false);
  }

  async function handleAdvance() {
    if (!task) return;
    const next = nextPrintStatus(task.status);
    if (!next) return;
    setSaving(true);
    setError(null);

    let photoUrl = task.photo_url;
    if (photo) {
      const uploaded = await uploadPrintPhoto(bookingId, photo);
      if (uploaded) photoUrl = uploaded;
    }

    const { data, error: err } = await updatePrintTask(task.id, {
      status: next,
      notes: notes.trim() || null,
      photoUrl,
    });
    if (err || !data) { setError(err || 'Failed to update status'); setSaving(false); return; }

    const actor = await getActivityActor();
    await logActivity({
      entityType: 'print_task', entityId: task.id, campaignId,
      action: 'print_task.status_changed',
      summary: data.updated_on_behalf_of_owner
        ? `${boardName} print status → ${PRINT_STATUS_LABELS[next]} (updated by agency on behalf of owner)`
        : `${boardName} print status → ${PRINT_STATUS_LABELS[next]}`,
      ...actor,
      changes: { status: { from: task.status, to: next } },
      metadata: data.updated_on_behalf_of_owner ? { on_behalf_of_owner: true } : undefined,
    });
    setTask(data);
    setPhoto(null);
    setRefreshKey(k => k + 1);
    onChange?.(data);
    setSaving(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: 440, background: '#fff', height: '100%', overflowY: 'auto',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.15)', fontFamily: "'Inter', -apple-system, sans-serif",
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', flexShrink: 0, position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Print status</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{boardName}</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, display: 'flex', borderRadius: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {loading ? (
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>Loading…</p>
          ) : !task ? (
            canManage ? (
              <div>
                <p style={{ fontSize: '0.8125rem', color: '#475569', margin: '0 0 14px' }}>
                  Print tracking hasn&apos;t been set up for this board yet. Choose who&apos;s responsible for getting the creative printed.
                </p>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#374151', marginBottom: 4 }}>Responsible party</label>
                <select
                  value={newParty}
                  onChange={e => setNewParty(e.target.value as ResponsibleParty)}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 14 }}
                >
                  <option value="">Select…</option>
                  <option value="agency">Agency</option>
                  <option value="client">Client</option>
                  <option value="board_owner">Board owner</option>
                </select>
                {error && <p style={{ fontSize: '0.75rem', color: '#DC2626', margin: '0 0 10px' }}>⚠ {error}</p>}
                <button
                  onClick={handleCreate}
                  disabled={!newParty || saving}
                  style={{ width: '100%', padding: '11px', background: !newParty || saving ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: !newParty || saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {saving ? 'Setting up…' : 'Set up print tracking'}
                </button>
              </div>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>Print tracking hasn&apos;t been set up for this board yet.</p>
            )
          ) : (
            <>
              {/* Current status */}
              <div style={{ background: PRINT_STATUS_STYLE[task.status].bg, border: `1px solid ${PRINT_STATUS_STYLE[task.status].dot}33`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: PRINT_STATUS_STYLE[task.status].dot }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: PRINT_STATUS_STYLE[task.status].color }}>
                    {PRINT_STATUS_LABELS[task.status]}
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: PRINT_STATUS_STYLE[task.status].color, margin: 0, opacity: 0.85 }}>
                  Responsible: {RESPONSIBLE_PARTY_LABELS[task.responsible_party]}
                  {task.updated_on_behalf_of_owner && ' (updated by agency on behalf of owner)'}
                </p>
                {task.updated_by_name && (
                  <p style={{ fontSize: '0.6875rem', color: PRINT_STATUS_STYLE[task.status].color, margin: '4px 0 0', opacity: 0.7 }}>
                    Last updated by {task.updated_by_name} · {new Date(task.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
                {task.notes && (
                  <p style={{ fontSize: '0.75rem', color: PRINT_STATUS_STYLE[task.status].color, margin: '6px 0 0', fontStyle: 'italic' }}>&ldquo;{task.notes}&rdquo;</p>
                )}
                {task.photo_url && (
                  <a href={task.photo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.6875rem', fontWeight: 600, color: PRINT_STATUS_STYLE[task.status].color, textDecoration: 'underline', display: 'inline-block', marginTop: 6 }}>
                    View photo ↗
                  </a>
                )}
              </div>

              {/* Progress steps */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
                {PRINT_STATUS_ORDER.map((s, i) => {
                  const reached = PRINT_STATUS_ORDER.indexOf(task.status) >= i;
                  return (
                    <div key={s} style={{ flex: 1 }} title={PRINT_STATUS_LABELS[s]}>
                      <div style={{ height: 4, borderRadius: 2, background: reached ? PRINT_STATUS_STYLE[task.status].dot : '#E2E8F0' }} />
                    </div>
                  );
                })}
              </div>

              {!canAct && (
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', background: '#F8FAFC', borderRadius: 8, padding: '10px 12px', margin: '0 0 16px' }}>
                  Read-only — only {RESPONSIBLE_PARTY_LABELS[task.responsible_party].toLowerCase()} can update this.
                </p>
              )}

              {canAct && nextPrintStatus(task.status) && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#374151', marginBottom: 4 }}>Notes (optional)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.8125rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', marginBottom: 10 }}
                  />
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#374151', marginBottom: 4 }}>Photo (optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setPhoto(e.target.files?.[0] || null)}
                    style={{ fontSize: '0.75rem', marginBottom: 12 }}
                  />
                  {error && <p style={{ fontSize: '0.75rem', color: '#DC2626', margin: '0 0 10px' }}>⚠ {error}</p>}
                  <button
                    onClick={handleAdvance}
                    disabled={saving}
                    style={{ width: '100%', padding: '11px', background: saving ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                  >
                    {saving ? 'Updating…' : `Mark as ${PRINT_STATUS_LABELS[nextPrintStatus(task.status)!]}`}
                  </button>
                </div>
              )}

              {canManage && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reassign responsibility</label>
                  <select
                    value={task.responsible_party}
                    onChange={e => handleReassign(e.target.value as ResponsibleParty)}
                    disabled={saving}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.8125rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' }}
                  >
                    <option value="agency">Agency</option>
                    <option value="client">Client</option>
                    <option value="board_owner">Board owner</option>
                  </select>
                </div>
              )}

              <ActivityTimeline entityType="print_task" entityId={task.id} title="Print status history" refreshKey={refreshKey} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
