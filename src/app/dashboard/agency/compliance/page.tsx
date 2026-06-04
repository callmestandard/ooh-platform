'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notifications';
import { formatDate } from '@/lib/utils';

type ComplianceCheck = {
  id: string;
  booking_id: string;
  photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  submitted_at: string;
  submitted_by: string | null;
  status: 'submitted' | 'verified' | 'flagged';
  notes: string | null;
  ai_verdict: 'verified' | 'review' | 'flagged' | null;
  ai_confidence: number | null;
  ai_notes: string | null;
  ai_verified_at: string | null;
  bookings: {
    id: string;
    start_date: string;
    end_date: string;
    boards: {
      name: string;
      address: string;
      city: string;
      format: string;
    };
    campaigns: {
      name: string;
    };
  };
};

type Booking = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  boards: { name: string; address: string; city: string; format: string };
  campaigns: { name: string };
};

const STATUS_CONFIG = {
  verified: { label: 'Verified', dot: '#10B981', bg: '#ECFDF5', text: '#064E3B' },
  submitted: { label: 'Pending review', dot: '#F59E0B', bg: '#FFFBEB', text: '#92400E' },
  flagged: { label: 'Flagged', dot: '#EF4444', bg: '#FEF2F2', text: '#7F1D1D' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

export default function CompliancePage() {
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'upload' | 'history'>('overview');
  const [selectedCheck, setSelectedCheck] = useState<ComplianceCheck | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');

  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Upload state
  const [uploadBookingId, setUploadBookingId] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadPhoto, setUploadPhoto] = useState<File | null>(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const { data: { session: compSession } } = await supabase.auth.getSession();
    const uid = compSession?.user?.id;
    if (!uid) { setLoading(false); return; }

    const [checksRes, bookingsRes] = await Promise.all([
      supabase.from('compliance_checks').select(`
        *, bookings!inner (id, start_date, end_date,
          boards (name, address, city, format),
          campaigns!inner (name, agency_id)
        )
      `).eq('bookings.campaigns.agency_id', uid).order('submitted_at', { ascending: false }),
      supabase.from('bookings').select(`
        id, status, start_date, end_date,
        boards (name, address, city, format),
        campaigns!inner (name, agency_id)
      `).eq('campaigns.agency_id', uid).in('status', ['pending', 'negotiating', 'agreed', 'signed', 'live'])
    ]);

    if (checksRes.data) setChecks(checksRes.data as ComplianceCheck[]);
    if (bookingsRes.data) setBookings(bookingsRes.data as unknown as Booking[]);
    setLoading(false);
  }

  async function getLocation() {
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGettingLocation(false);
      },
      () => setGettingLocation(false)
    );
  }

  async function handleUpload() {
    if (!uploadBookingId) return;
    setUploadSubmitting(true);

    const { error } = await supabase.from('compliance_checks').insert({
      booking_id: uploadBookingId,
      status: 'submitted',
      submitted_by: 'Agency Field Team',
      notes: uploadNotes || null,
      latitude: location?.lat || null,
      longitude: location?.lng || null,
      submitted_at: new Date().toISOString(),
    });

    if (!error) {
      setUploadSuccess(true);
      // Find the board name for a useful notification body
      const booking = bookings.find(b => b.id === uploadBookingId);
      const boardName = booking?.boards?.name || 'a board';
      await createNotification({
        recipientRole: 'agency',
        type: 'poe_submitted',
        title: 'Proof of posting submitted',
        body: `Field team uploaded proof for ${boardName}. Review in Compliance.`,
        link: '/dashboard/agency/compliance',
      });
      setUploadBookingId('');
      setUploadNotes('');
      setUploadPhoto(null);
      setLocation(null);
      setTimeout(() => {
        setUploadSuccess(false);
        setActiveTab('overview');
        fetchData();
      }, 2000);
    }
    setUploadSubmitting(false);
  }

  async function updateStatus(id: string, status: 'verified' | 'flagged') {
    await supabase.from('compliance_checks').update({ status }).eq('id', id);
    setChecks(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    if (selectedCheck?.id === id) setSelectedCheck(prev => prev ? { ...prev, status } : null);

    const check = checks.find(c => c.id === id);
    const boardName = check?.bookings?.boards?.name || 'a board';
    await createNotification({
      recipientRole: 'client',
      type: status === 'verified' ? 'poe_verified' : 'poe_flagged',
      title: status === 'verified' ? 'Proof of posting verified' : 'Proof of posting flagged',
      body: status === 'verified'
        ? `${boardName} compliance has been verified`
        : `${boardName} has been flagged — please review`,
      link: '/dashboard/client?tab=compliance',
    });
  }

  async function aiVerify(checkId: string) {
    setVerifyingId(checkId);
    try {
      const res = await fetch('/api/compliance/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compliance_check_id: checkId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setChecks(prev => prev.map(c => c.id === checkId ? {
        ...c,
        ai_verdict: data.verdict,
        ai_confidence: data.confidence,
        ai_notes: data.summary,
        ai_verified_at: new Date().toISOString(),
      } : c));
      if (selectedCheck?.id === checkId) {
        setSelectedCheck(prev => prev ? {
          ...prev,
          ai_verdict: data.verdict,
          ai_confidence: data.confidence,
          ai_notes: data.summary,
          ai_verified_at: new Date().toISOString(),
        } : null);
      }
    } catch (err) {
      console.error('AI verify:', err);
    }
    setVerifyingId(null);
  }

  const filtered = filterStatus === 'all' ? checks : checks.filter(c => c.status === filterStatus);
  const stats = {
    total: checks.length,
    verified: checks.filter(c => c.status === 'verified').length,
    pending: checks.filter(c => c.status === 'submitted').length,
    flagged: checks.filter(c => c.status === 'flagged').length,
    rate: checks.length > 0 ? Math.round((checks.filter(c => c.status === 'verified').length / checks.length) * 100) : 0,
  };

  return (
    <div style={{ fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        .comp-row:hover { background: #F5F8FF; cursor: pointer; }
        .tab-btn { transition: all 0.15s ease; cursor: pointer; border: none; background: none; font-family: inherit; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.25s ease forwards; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
            Compliance
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '4px 0 0' }}>
            Proof of posting, board status, and field verification
          </p>
        </div>
        <button
          onClick={() => setActiveTab('upload')}
          style={{
            background: '#1B4F8A', color: '#fff', border: 'none',
            padding: '10px 18px', borderRadius: '10px', fontSize: '0.8125rem',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: '6px'
          }}
        >
          + Upload proof of posting
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total checks', value: stats.total, color: '#0F172A' },
          { label: 'Compliance rate', value: `${stats.rate}%`, color: stats.rate >= 90 ? '#059669' : stats.rate >= 70 ? '#D97706' : '#DC2626' },
          { label: 'Verified', value: stats.verified, color: '#059669' },
          { label: 'Pending review', value: stats.pending, color: '#D97706' },
          { label: 'Flagged', value: stats.flagged, color: '#DC2626' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '1rem 1.125rem' }}>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 500, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
            <p style={{ fontSize: '1.625rem', fontWeight: 600, color, margin: 0, letterSpacing: '-0.02em' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Compliance bar */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>Overall compliance rate</span>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: stats.rate >= 90 ? '#059669' : stats.rate >= 70 ? '#D97706' : '#DC2626' }}>{stats.rate}%</span>
        </div>
        <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: '999px', transition: 'width 0.8s ease',
            width: `${stats.rate}%`,
            background: stats.rate >= 90 ? '#10B981' : stats.rate >= 70 ? '#F59E0B' : '#EF4444'
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
          <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>Target: 95%</span>
          <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{stats.verified} of {stats.total} verified</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.25rem', background: '#F1F5F9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[
          { key: 'overview', label: 'All checks' },
          { key: 'upload', label: 'Upload proof' },
          { key: 'history', label: 'Flagged boards' },
        ].map(tab => (
          <button
            key={tab.key}
            className="tab-btn"
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '7px 16px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 500,
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab.label}
            {tab.key === 'history' && stats.flagged > 0 && (
              <span style={{ marginLeft: '6px', background: '#FEE2E2', color: '#DC2626', borderRadius: '999px', padding: '1px 6px', fontSize: '0.6875rem', fontWeight: 600 }}>
                {stats.flagged}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* List */}
          <div style={{ flex: 1, background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
            {/* Filter row */}
            <div style={{ display: 'flex', gap: '6px', padding: '12px 16px', borderBottom: '1px solid #F1F5F9' }}>
              {['all', 'verified', 'submitted', 'flagged'].map(f => (
                <button key={f} onClick={() => setFilterStatus(f)} style={{
                  padding: '4px 12px', borderRadius: '999px', border: 'none',
                  background: filterStatus === f ? '#1B4F8A' : '#F1F5F9',
                  color: filterStatus === f ? '#fff' : '#64748B',
                  fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  textTransform: 'capitalize'
                }}>
                  {f === 'submitted' ? 'Pending' : f === 'all' ? `All (${checks.length})` : f}
                </button>
              ))}
            </div>

            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📸</div>
                <p style={{ margin: 0, fontWeight: 500, color: '#64748B' }}>No compliance checks yet</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.8125rem' }}>Upload the first proof of posting</p>
              </div>
            ) : filtered.map((check, i) => {
              const cfg = STATUS_CONFIG[check.status];
              const isSelected = selectedCheck?.id === check.id;
              return (
                <div
                  key={check.id}
                  className="comp-row fade-up"
                  onClick={() => setSelectedCheck(isSelected ? null : check)}
                  style={{
                    padding: '14px 16px',
                    borderBottom: i < filtered.length - 1 ? '1px solid #F8FAFC' : 'none',
                    background: isSelected ? '#F8FAFF' : 'transparent',
                    borderLeft: isSelected ? '3px solid #1B4F8A' : '3px solid transparent',
                    transition: 'all 0.15s ease',
                    animationDelay: `${i * 0.04}s`
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', background: '#F1F5F9', padding: '2px 7px', borderRadius: '4px' }}>
                          {FORMAT_LABELS[check.bookings?.boards?.format] || check.bookings?.boards?.format || '—'}
                        </span>
                        <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>
                          {check.bookings?.campaigns?.name || '—'}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {check.bookings?.boards?.name || 'Unknown board'}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 4px' }}>
                        {check.bookings?.boards?.address || '—'}
                      </p>
                      <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>
                        Submitted {formatDate(check.submitted_at)} at {formatTime(check.submitted_at)}
                        {check.submitted_by && ` · ${check.submitted_by}`}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        background: cfg.bg, color: cfg.text, padding: '4px 10px',
                        borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot }} />
                        {cfg.label}
                      </span>
                      {check.ai_verdict && (
                        <span style={{
                          fontSize: '0.625rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                          background: check.ai_verdict === 'verified' ? '#D1FAE5' : check.ai_verdict === 'flagged' ? '#FEE2E2' : '#FEF3C7',
                          color: check.ai_verdict === 'verified' ? '#065F46' : check.ai_verdict === 'flagged' ? '#991B1B' : '#92400E',
                        }}>
                          AI: {check.ai_verdict} {check.ai_confidence != null ? `${Math.round(check.ai_confidence * 100)}%` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  {check.notes && (
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '8px 0 0', fontStyle: 'italic' }}>
                      "{check.notes}"
                    </p>
                  )}
                </div>
              );
            })}
            {!loading && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                  Showing {filtered.length} of {checks.length} check{checks.length !== 1 ? 's' : ''}
                </span>
                <button onClick={() => setActiveTab('upload')} style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>
                  + Upload proof
                </button>
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedCheck && (
            <div style={{ width: '280px', flexShrink: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', alignSelf: 'flex-start' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>Check detail</span>
                <button onClick={() => setSelectedCheck(null)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
              </div>

              {/* Photo placeholder */}
              <div style={{ margin: '12px', height: '140px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {selectedCheck.photo_url ? (
                  <img src={selectedCheck.photo_url} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📷</div>
                    <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0 }}>No photo uploaded</p>
                  </div>
                )}
              </div>

              <div style={{ padding: '0 12px 12px' }}>
                {[
                  { label: 'Board', value: selectedCheck.bookings?.boards?.name },
                  { label: 'Campaign', value: selectedCheck.bookings?.campaigns?.name },
                  { label: 'Submitted', value: `${formatDate(selectedCheck.submitted_at)} ${formatTime(selectedCheck.submitted_at)}` },
                  { label: 'By', value: selectedCheck.submitted_by || '—' },
                  { label: 'GPS', value: selectedCheck.latitude ? `${selectedCheck.latitude?.toFixed(4)}, ${selectedCheck.longitude?.toFixed(4)}` : 'Not captured' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F8FAFC' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{label}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#0F172A', textAlign: 'right', maxWidth: '55%' }}>{value || '—'}</span>
                  </div>
                ))}

                {selectedCheck.notes && (
                  <div style={{ marginTop: '10px', background: '#FFFBEB', borderRadius: '8px', padding: '8px 10px' }}>
                    <p style={{ fontSize: '0.6875rem', color: '#92400E', margin: 0 }}>"{selectedCheck.notes}"</p>
                  </div>
                )}

                {/* AI Verification section */}
                {selectedCheck.photo_url && (
                  <div style={{ marginTop: 12, background: '#F8FAFC', borderRadius: 8, padding: '10px 12px', border: '1px solid #E8EDF2' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: selectedCheck.ai_verdict ? 8 : 0 }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI Verification</span>
                      <button
                        onClick={() => aiVerify(selectedCheck.id)}
                        disabled={verifyingId === selectedCheck.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          background: verifyingId === selectedCheck.id ? '#F1F5F9' : '#7C3AED',
                          color: verifyingId === selectedCheck.id ? '#94A3B8' : '#fff',
                          border: 'none', borderRadius: 6, padding: '5px 10px',
                          fontSize: '0.6875rem', fontWeight: 700, cursor: verifyingId === selectedCheck.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        {verifyingId === selectedCheck.id ? (
                          <>
                            <span style={{ width: 10, height: 10, border: '1.5px solid #CBD5E1', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                            Analysing…
                          </>
                        ) : (
                          <>✦ {selectedCheck.ai_verdict ? 'Re-run AI' : 'Run AI check'}</>
                        )}
                      </button>
                    </div>
                    {selectedCheck.ai_verdict && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{
                            fontSize: '0.6875rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                            background: selectedCheck.ai_verdict === 'verified' ? '#D1FAE5' : selectedCheck.ai_verdict === 'flagged' ? '#FEE2E2' : '#FEF3C7',
                            color: selectedCheck.ai_verdict === 'verified' ? '#065F46' : selectedCheck.ai_verdict === 'flagged' ? '#991B1B' : '#92400E',
                          }}>
                            {selectedCheck.ai_verdict === 'verified' ? '✓ Verified' : selectedCheck.ai_verdict === 'flagged' ? '✕ Flagged' : '⚠ Needs review'}
                          </span>
                          {selectedCheck.ai_confidence != null && (
                            <span style={{ fontSize: '0.625rem', color: '#94A3B8', fontWeight: 600 }}>
                              {Math.round(selectedCheck.ai_confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                        {selectedCheck.ai_notes && (
                          <p style={{ fontSize: '0.6875rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>{selectedCheck.ai_notes}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedCheck.status === 'submitted' && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                    <button
                      onClick={() => updateStatus(selectedCheck.id, 'verified')}
                      style={{ flex: 1, background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '8px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      ✓ Verify
                    </button>
                    <button
                      onClick={() => updateStatus(selectedCheck.id, 'flagged')}
                      style={{ flex: 1, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '8px', padding: '8px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      ✕ Flag
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload tab */}
      {activeTab === 'upload' && (
        <div style={{ maxWidth: '520px' }}>
          {uploadSuccess ? (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '14px', padding: '2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✅</div>
              <p style={{ fontWeight: 600, color: '#059669', margin: '0 0 4px' }}>Proof submitted successfully</p>
              <p style={{ fontSize: '0.875rem', color: '#065F46', margin: 0 }}>Redirecting to overview...</p>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1.25rem' }}>Upload proof of posting</h2>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>
                  Select booking <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <select
                  value={uploadBookingId}
                  onChange={e => setUploadBookingId(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #E2E8F0', fontSize: '0.875rem', background: '#fff', outline: 'none', fontFamily: 'inherit' }}
                >
                  <option value="">Select a booking...</option>
                  {bookings.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.boards?.name} — {b.campaigns?.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Photo upload */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>
                  Photo
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: '2px dashed #E2E8F0', borderRadius: '10px', padding: '1.5rem',
                    textAlign: 'center', cursor: 'pointer', background: uploadPhoto ? '#F0FDF4' : '#FAFAFA'
                  }}
                >
                  {uploadPhoto ? (
                    <p style={{ fontSize: '0.875rem', color: '#059669', margin: 0, fontWeight: 500 }}>✓ {uploadPhoto.name}</p>
                  ) : (
                    <>
                      <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📸</div>
                      <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>Click to upload photo</p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>JPG, PNG up to 10MB</p>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => setUploadPhoto(e.target.files?.[0] || null)} />
              </div>

              {/* GPS */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>
                  GPS location
                </label>
                {location ? (
                  <div style={{ background: '#ECFDF5', borderRadius: '10px', padding: '10px 12px', fontSize: '0.8125rem', color: '#059669', fontWeight: 500 }}>
                    ✓ Location captured: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                  </div>
                ) : (
                  <button
                    onClick={getLocation}
                    disabled={gettingLocation}
                    style={{
                      width: '100%', padding: '10px', borderRadius: '10px',
                      border: '1px solid #E2E8F0', background: '#F8FAFC',
                      fontSize: '0.8125rem', color: '#64748B', cursor: 'pointer',
                      fontFamily: 'inherit', fontWeight: 500
                    }}
                  >
                    {gettingLocation ? 'Getting location...' : '📍 Capture GPS location'}
                  </button>
                )}
              </div>

              {/* Notes */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>
                  Notes
                </label>
                <textarea
                  value={uploadNotes}
                  onChange={e => setUploadNotes(e.target.value)}
                  rows={3}
                  placeholder="Board condition, visibility notes, any issues..."
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #E2E8F0', fontSize: '0.875rem', resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              </div>

              <button
                onClick={handleUpload}
                disabled={uploadSubmitting || !uploadBookingId}
                style={{
                  width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                  background: uploadBookingId ? '#1B4F8A' : '#E2E8F0',
                  color: uploadBookingId ? '#fff' : '#94A3B8',
                  fontSize: '0.875rem', fontWeight: 600, cursor: uploadBookingId ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit'
                }}
              >
                {uploadSubmitting ? 'Submitting...' : 'Submit proof of posting'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Flagged tab */}
      {activeTab === 'history' && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
          {checks.filter(c => c.status === 'flagged').length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✅</div>
              <p style={{ fontWeight: 500, color: '#059669', margin: '0 0 4px' }}>No flagged boards</p>
              <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>All compliance checks are clear</p>
            </div>
          ) : checks.filter(c => c.status === 'flagged').map((check, i, arr) => {
            const cfg = STATUS_CONFIG.flagged;
            return (
              <div key={check.id} style={{ padding: '16px 20px', borderBottom: i < arr.length - 1 ? '1px solid #FEF2F2' : 'none', background: '#FFFAFA' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                      {check.bookings?.boards?.name || 'Unknown board'}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 4px' }}>
                      {check.bookings?.campaigns?.name} · {formatDate(check.submitted_at)}
                    </p>
                    {check.notes && (
                      <p style={{ fontSize: '0.75rem', color: '#DC2626', margin: 0, fontStyle: 'italic' }}>
                        "{check.notes}"
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => updateStatus(check.id, 'verified')}
                    style={{ background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                  >
                    Mark resolved
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}