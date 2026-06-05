'use client';

import { useState, useEffect, useRef } from 'react';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { ROLE_STORAGE_KEY, type DemoRole } from '@/lib/constants';
import type { NotificationType } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileData = {
  displayName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  bio: string;
  erpVendorCode: string;
};

type NotifPrefs = Record<NotificationType, boolean>;

type PayoutData = {
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'invited';
  joinedAt: string;
};

type BrandingData = {
  accentColor: string;
  companyWebsite: string;
  tagline: string;
  logoUrl: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NIGERIAN_BANKS = [
  'Access Bank', 'Zenith Bank', 'GTBank', 'First Bank', 'UBA',
  'Fidelity Bank', 'FCMB', 'Union Bank', 'Stanbic IBTC', 'Sterling Bank',
  'Wema Bank', 'Heritage Bank', 'Keystone Bank', 'Polaris Bank', 'Providus Bank',
  'Moniepoint MFB', 'Kuda MFB', 'Opay', 'PalmPay',
];

const NOTIF_LABELS: Record<NotificationType, { label: string; desc: string; roles: DemoRole[] }> = {
  new_booking:      { label: 'New booking request',    desc: 'When an agency books one of your boards',                  roles: ['owner'] },
  counter_offer:    { label: 'Counter offer',           desc: 'When a counter-offer is made on a negotiation',           roles: ['agency', 'owner', 'client'] },
  offer_accepted:   { label: 'Offer accepted',           desc: 'When your offer or counter-offer is accepted',            roles: ['agency', 'owner'] },
  offer_declined:   { label: 'Offer declined',           desc: 'When your offer or counter-offer is declined',            roles: ['agency', 'owner'] },
  message:          { label: 'New message',              desc: 'When you receive a new message in negotiations',          roles: ['agency', 'owner', 'client'] },
  poe_submitted:    { label: 'Proof of posting',         desc: 'When a field rep submits a proof of posting photo',      roles: ['agency', 'client'] },
  poe_verified:     { label: 'POE verified',             desc: 'When a proof of posting is verified by the agency',      roles: ['client'] },
  poe_flagged:      { label: 'POE flagged',              desc: 'When a proof of posting is flagged for review',          roles: ['client'] },
  plan_approved:    { label: 'Plan approved',            desc: 'When a client approves your media plan',                 roles: ['agency', 'client'] },
  campaign_request: { label: 'New campaign brief',       desc: 'When a client submits a new campaign brief',             roles: ['agency'] },
  mpo_raised:       { label: 'MPO received',             desc: 'When an agency raises a Media Purchase Order for you',   roles: ['owner'] },
  invoice_sent:     { label: 'Invoice received',         desc: 'When your agency sends you an invoice',                  roles: ['client'] },
  invoice_paid:     { label: 'Payment received',         desc: 'When a client pays an invoice',                          roles: ['agency'] },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStorageKey(role: string, key: string) { return `ooh_settings_${role}_${key}`; }

function loadJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

function saveJSON(key: string, val: unknown) {
  localStorage.setItem(key, JSON.stringify(val));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid #F1F5F9' }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>{subtitle}</p>}
      </div>
      <div style={{ padding: '22px 24px' }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8,
  fontSize: '0.875rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit',
  background: '#fff', boxSizing: 'border-box', transition: 'border-color 0.15s, box-shadow 0.15s',
};

function Input({ value, onChange, placeholder, type = 'text', disabled }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; disabled?: boolean;
}) {
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} disabled={disabled}
      style={{ ...inputStyle, background: disabled ? '#F8FAFC' : '#fff', cursor: disabled ? 'not-allowed' : 'text' }}
      onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: 'pointer' }}
      onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <option value="">Select...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: checked ? '#1B4F8A' : '#E2E8F0',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function SaveButton({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{
        padding: '9px 20px', background: saved ? '#10B981' : '#1B4F8A',
        color: '#fff', border: 'none', borderRadius: 8,
        fontSize: '0.875rem', fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
        fontFamily: 'inherit', transition: 'background 0.2s',
        display: 'flex', alignItems: 'center', gap: 7,
      }}
    >
      {saving ? (
        <><span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} /> Saving...</>
      ) : saved ? (
        <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> Saved</>
      ) : 'Save changes'}
    </button>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, role, avatarUrl, onUpload, uploading }: {
  name: string; role: DemoRole;
  avatarUrl?: string | null;
  onUpload?: () => void;
  uploading?: boolean;
}) {
  const roleColors: Record<DemoRole, string> = {
    agency: '#1B4F8A', client: '#059669', owner: '#7C3AED', admin: '#DC2626',
  };
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
        ) : (
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: roleColors[role], display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '1.5rem', fontWeight: 700, color: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}>
            {initials || '??'}
          </div>
        )}
        {uploading && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
      </div>
      <div>
        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Profile photo</p>
        <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 10px' }}>
          {avatarUrl ? 'Your photo is shown across the platform.' : 'Auto-generated from your name — upload a photo to personalise.'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onUpload}
            disabled={uploading}
            style={{ fontSize: '0.75rem', fontWeight: 600, color: uploading ? '#94A3B8' : '#1B4F8A', background: uploading ? '#F1F5F9' : '#EFF6FF', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            {uploading ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: '6px 0 0' }}>JPG, PNG or WebP · max 5 MB</p>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const role = useDashboardRole();
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'payout' | 'team' | 'branding' | 'security'>('profile');
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile state
  const [profile, setProfile] = useState<ProfileData>({ displayName: '', email: '', phone: '', company: '', jobTitle: '', bio: '', erpVendorCode: '' });

  // Notification prefs
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    new_booking: true, counter_offer: true, offer_accepted: true,
    offer_declined: true, message: true, poe_submitted: true, poe_verified: true,
    poe_flagged: true, plan_approved: true, campaign_request: true,
    mpo_raised: true, invoice_sent: true, invoice_paid: true,
  });

  // Payout (owner only)
  const [payout, setPayout] = useState<PayoutData>({ bankName: '', accountNumber: '', accountName: '', bankCode: '' });

  // Team members (agency only)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([
    { id: '1', name: 'Alex Okonkwo', email: 'alex@mediapro.ng', role: 'Admin', status: 'active', joinedAt: '2024-01-15' },
  ]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // Branding (agency only)
  const [branding, setBranding] = useState<BrandingData>({ accentColor: '#1B4F8A', companyWebsite: '', tagline: '', logoUrl: '' });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [agencyProfileId, setAgencyProfileId] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Password change
  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError]       = useState('');
  const [pwSuccess, setPwSuccess]   = useState(false);

  // Avatar
  const [avatarUrl, setAvatarUrl]         = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    if (!role) return;
    const storedProfile = loadJSON<ProfileData>(getStorageKey(role, 'profile'), {
      displayName: role === 'agency' ? 'Alex Okonkwo' : role === 'client' ? 'MTN Nigeria' : role === 'owner' ? 'Alhaji Sule' : 'Tunde Adeyemi',
      email: `${role}@oohplatform.ng`,
      phone: '',
      company: role === 'agency' ? 'MediaPro Lagos' : role === 'client' ? 'MTN Nigeria' : role === 'owner' ? 'Sule Outdoor' : 'OOH Platform',
      jobTitle: role === 'agency' ? 'Media Director' : role === 'client' ? 'Marketing Manager' : role === 'owner' ? 'Business Owner' : 'Platform Admin',
      bio: '',
      erpVendorCode: '',
    });
    setProfile(storedProfile);
    setNotifPrefs(loadJSON<NotifPrefs>(getStorageKey(role, 'notif_prefs'), notifPrefs));
    if (role === 'owner') setPayout(loadJSON<PayoutData>(getStorageKey(role, 'payout'), payout));
    // Load avatar + agency branding from Supabase for all roles
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setProfileUserId(user.id);
      supabase
        .from('profiles')
        .select('avatar_url, brand_accent_color, brand_tagline, brand_website, brand_logo_url, erp_vendor_code')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (!data) return;
          const row = data as {
            avatar_url?: string | null;
            brand_accent_color?: string | null;
            brand_tagline?: string | null;
            brand_website?: string | null;
            brand_logo_url?: string | null;
            erp_vendor_code?: string | null;
          };
          if (row.avatar_url) setAvatarUrl(row.avatar_url);
          if (role === 'agency') {
            setAgencyProfileId(user.id);
            setProfile(p => ({ ...p, erpVendorCode: row.erp_vendor_code || '' }));
            setBranding(prev => ({
              ...prev,
              accentColor: row.brand_accent_color || prev.accentColor,
              tagline: row.brand_tagline || prev.tagline,
              companyWebsite: row.brand_website || prev.companyWebsite,
              logoUrl: row.brand_logo_url || prev.logoUrl,
            }));
          }
        });
    });

    if (role === 'agency') {
      setBranding(loadJSON<BrandingData>(getStorageKey(role, 'branding'), branding));
    }
  }, [role]); // eslint-disable-line

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave() {
    if (!role) return;
    setSaving(true);
    saveJSON(getStorageKey(role, 'profile'), profile);
    saveJSON(getStorageKey(role, 'notif_prefs'), notifPrefs);
    if (role === 'owner') saveJSON(getStorageKey(role, 'payout'), payout);
    if (role === 'agency') {
      saveJSON(getStorageKey(role, 'branding'), branding);
      // Persist to Supabase
      if (agencyProfileId) {
        await supabase.from('profiles').update({
          brand_accent_color: branding.accentColor,
          brand_tagline: branding.tagline || null,
          brand_website: branding.companyWebsite || null,
          brand_logo_url: branding.logoUrl || null,
          erp_vendor_code: profile.erpVendorCode.trim() || null,
        }).eq('id', agencyProfileId);
      }
    }
    setSaving(false);
    setSaved(true);
    showToast('Settings saved successfully');
    setTimeout(() => setSaved(false), 3000);
  }

  async function uploadLogo(file: File) {
    if (!agencyProfileId) return;
    setUploadingLogo(true);
    const ext = file.name.split('.').pop();
    const path = `${agencyProfileId}/logo.${ext}`;
    const { error } = await supabase.storage.from('agency-logos').upload(path, file, { upsert: true, contentType: file.type });
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('agency-logos').getPublicUrl(path);
      setBranding(b => ({ ...b, logoUrl: publicUrl }));
    }
    setUploadingLogo(false);
  }

  async function uploadAvatar(file: File) {
    if (!profileUserId) { showToast('Sign in to upload a photo'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5 MB'); return; }
    if (!file.type.startsWith('image/')) { showToast('Only image files allowed'); return; }

    setUploadingAvatar(true);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${profileUserId}/avatar.${ext}`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (error) {
      showToast(`Upload failed: ${error.message}`);
    } else {
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust so the new image loads immediately
      const busted = `${publicUrl}?t=${Date.now()}`;
      setAvatarUrl(busted);
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', profileUserId);
      showToast('Profile photo updated');
    }
    setUploadingAvatar(false);
  }

  async function handleChangePassword() {
    setPwError('');
    setPwSuccess(false);
    if (!currentPw) { setPwError('Enter your current password.'); return; }
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }

    setChangingPw(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) {
        setPwError('No active session — please sign in again.');
        return;
      }

      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPw,
      });
      if (signInError) {
        setPwError('Current password is incorrect.');
        return;
      }

      // Update to new password
      const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
      if (updateError) {
        setPwError(updateError.message);
        return;
      }

      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 4000);
    } finally {
      setChangingPw(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) return;
    setInviting(true);
    await new Promise(r => setTimeout(r, 800));
    const newMember: TeamMember = {
      id: Date.now().toString(),
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: 'Member',
      status: 'invited',
      joinedAt: new Date().toISOString().slice(0, 10),
    };
    setTeamMembers(prev => [...prev, newMember]);
    setInviteEmail('');
    setInviting(false);
    showToast(`Invitation sent to ${inviteEmail}`);
  }

  if (!role) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const tabs: { key: typeof activeTab; label: string; roles: DemoRole[] }[] = (
    [
      { key: 'profile'       as const, label: 'Profile',        roles: ['agency', 'client', 'owner', 'admin'] as DemoRole[] },
      { key: 'notifications' as const, label: 'Notifications',  roles: ['agency', 'client', 'owner', 'admin'] as DemoRole[] },
      { key: 'payout'        as const, label: 'Payouts',        roles: ['owner'] as DemoRole[] },
      { key: 'team'          as const, label: 'Team',           roles: ['agency'] as DemoRole[] },
      { key: 'branding'      as const, label: 'Branding',       roles: ['agency'] as DemoRole[] },
      { key: 'security'      as const, label: 'Security',       roles: ['agency', 'client', 'owner', 'admin'] as DemoRole[] },
    ]
  ).filter(t => t.roles.includes(role));

  const roleColors: Record<DemoRole, string> = {
    agency: '#1B4F8A', client: '#059669', owner: '#7C3AED', admin: '#DC2626',
  };
  const roleLabels: Record<DemoRole, string> = {
    agency: 'Agency', client: 'Client', owner: 'Board Owner', admin: 'Platform Admin',
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", maxWidth: 780 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toastIn { from { opacity:0; transform:translateY(8px) translateX(-50%); } to { opacity:1; transform:translateY(0) translateX(-50%); } }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#0F172A', color: '#fff', padding: '11px 20px', borderRadius: 10,
          fontSize: '0.875rem', fontWeight: 500, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          animation: 'toastIn 0.2s ease', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          {toast}
        </div>
      )}

      {/* Page header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: 0 }}>Settings</h1>
          <span style={{ background: roleColors[role] + '15', color: roleColors[role], fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {roleLabels[role]}
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Manage your account, preferences, and billing details.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Sidebar nav */}
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: 8, position: 'sticky', top: 0 }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 12px', borderRadius: 8, border: 'none',
                background: activeTab === tab.key ? '#EFF6FF' : 'transparent',
                color: activeTab === tab.key ? '#1B4F8A' : '#475569',
                fontSize: '0.875rem', fontWeight: activeTab === tab.key ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                marginBottom: 2, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (activeTab !== tab.key) (e.currentTarget as HTMLElement).style.background = '#F8FAFC'; }}
              onMouseLeave={e => { if (activeTab !== tab.key) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {activeTab === tab.key && <span style={{ width: 3, height: 16, background: '#1B4F8A', borderRadius: 2 }} />}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div>

          {/* ── PROFILE ── */}
          {activeTab === 'profile' && (
            <div style={{ animation: 'slideIn 0.2s ease' }}>
              <SectionCard title="Your profile" subtitle="This information is visible to other users on the platform.">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ''; }}
                />
                <Avatar
                  name={profile.displayName}
                  role={role}
                  avatarUrl={avatarUrl}
                  onUpload={() => avatarInputRef.current?.click()}
                  uploading={uploadingAvatar}
                />
                <div style={{ height: 1, background: '#F1F5F9', margin: '20px 0' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Display name">
                    <Input value={profile.displayName} onChange={v => setProfile(p => ({ ...p, displayName: v }))} placeholder="Your full name" />
                  </Field>
                  <Field label="Email address">
                    <Input value={profile.email} onChange={v => setProfile(p => ({ ...p, email: v }))} type="email" placeholder="you@company.ng" />
                  </Field>
                  <Field label="Phone number">
                    <Input value={profile.phone} onChange={v => setProfile(p => ({ ...p, phone: v }))} placeholder="+234 80X XXX XXXX" />
                  </Field>
                  <Field label="Company name">
                    <Input value={profile.company} onChange={v => setProfile(p => ({ ...p, company: v }))} placeholder="Your company" />
                  </Field>
                  <Field label="Job title">
                    <Input value={profile.jobTitle} onChange={v => setProfile(p => ({ ...p, jobTitle: v }))} placeholder="e.g. Media Director" />
                  </Field>
                  {role === 'agency' && (
                    <Field label="ERP vendor code" hint="Your supplier ID in client systems (Oracle, SAP, etc.).">
                      <Input value={profile.erpVendorCode} onChange={v => setProfile(p => ({ ...p, erpVendorCode: v }))} placeholder="e.g. VND-OOH-00421" />
                    </Field>
                  )}
                </div>
                <Field label="Bio" hint="Brief description shown on your profile.">
                  <textarea
                    value={profile.bio}
                    onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                    placeholder={role === 'agency' ? 'e.g. Full-service OOH agency specialising in Lagos and Abuja markets.' : role === 'owner' ? 'e.g. Billboard operator with 20+ premium locations across Lagos State.' : 'Brief description...'}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                </Field>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <SaveButton onClick={handleSave} saving={saving} saved={saved} />
                </div>
              </SectionCard>

              {/* Account info */}
              <SectionCard title="Account information" subtitle="Read-only details about your account.">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {[
                    { label: 'Account type', value: roleLabels[role] },
                    { label: 'Member since', value: 'May 2025' },
                    { label: 'Account status', value: 'Active', color: '#10B981' },
                    { label: 'Platform', value: 'OOH Platform Nigeria' },
                  ].map(item => (
                    <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{item.label}</p>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: item.color || '#0F172A', margin: 0 }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {activeTab === 'notifications' && (
            <div style={{ animation: 'slideIn 0.2s ease' }}>
              <SectionCard title="Notification preferences" subtitle="Choose which alerts you want to receive on the platform.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(Object.entries(NOTIF_LABELS) as [NotificationType, typeof NOTIF_LABELS[NotificationType]][])
                    .filter(([, cfg]) => cfg.roles.includes(role))
                    .map(([type, cfg]) => (
                      <div
                        key={type}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '14px 16px', borderRadius: 10,
                          background: notifPrefs[type] ? '#F8FAFC' : '#fff',
                          border: '1px solid #F1F5F9', marginBottom: 6,
                          transition: 'background 0.15s',
                        }}
                      >
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{cfg.label}</p>
                          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{cfg.desc}</p>
                        </div>
                        <Toggle
                          checked={notifPrefs[type]}
                          onChange={v => setNotifPrefs(p => ({ ...p, [type]: v }))}
                        />
                      </div>
                    ))}
                </div>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <SaveButton onClick={handleSave} saving={saving} saved={saved} />
                </div>
              </SectionCard>

              <SectionCard title="Notification channels" subtitle="How you receive notifications.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'In-app notifications', desc: 'Bell icon in the sidebar — always on', enabled: true, locked: true },
                    { label: 'Email notifications', desc: 'Daily digest of activity to your email', enabled: false, locked: false },
                    { label: 'WhatsApp notifications', desc: 'Real-time alerts via WhatsApp Business API', enabled: false, locked: false, badge: 'Coming soon' },
                  ].map((ch, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: 10, border: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{ch.label}</p>
                          {ch.badge && (
                            <span style={{ background: '#F5F3FF', color: '#7C3AED', fontSize: '0.6875rem', fontWeight: 600, padding: '2px 7px', borderRadius: 999 }}>{ch.badge}</span>
                          )}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>{ch.desc}</p>
                      </div>
                      <Toggle checked={ch.enabled} onChange={() => {}} />
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── PAYOUT (owner only) ── */}
          {activeTab === 'payout' && role === 'owner' && (
            <div style={{ animation: 'slideIn 0.2s ease' }}>
              <SectionCard title="Payout details" subtitle="Your earnings will be sent to this bank account after each confirmed booking.">
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', gap: 10 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <p style={{ fontSize: '0.8125rem', color: '#92400E', margin: 0, lineHeight: 1.5 }}>
                    Platform commission of 12% is deducted automatically. Payouts are processed within 3-5 business days after campaign completion.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Bank name">
                    <Select value={payout.bankName} onChange={v => setPayout(p => ({ ...p, bankName: v }))} options={NIGERIAN_BANKS} />
                  </Field>
                  <Field label="Account number" hint="10-digit NUBAN account number">
                    <Input value={payout.accountNumber} onChange={v => setPayout(p => ({ ...p, accountNumber: v.slice(0, 10) }))} placeholder="0123456789" />
                  </Field>
                  <Field label="Account name" hint="Must match your bank records exactly">
                    <Input value={payout.accountName} onChange={v => setPayout(p => ({ ...p, accountName: v }))} placeholder="e.g. Sule Abdullahi" />
                  </Field>
                </div>

                <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
                  <SaveButton onClick={handleSave} saving={saving} saved={saved} />
                </div>
              </SectionCard>

              {/* Earnings summary */}
              <SectionCard title="Earnings summary" subtitle="Your lifetime earnings on OOH Platform.">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Total earned', value: '₦0', sub: 'Since joining', color: '#1B4F8A' },
                    { label: 'Pending payout', value: '₦0', sub: 'Processing now', color: '#F59E0B' },
                    { label: 'This month', value: '₦0', sub: 'May 2025', color: '#10B981' },
                  ].map(item => (
                    <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 10, padding: '14px 16px' }}>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{item.label}</p>
                      <p style={{ fontSize: '1.375rem', fontWeight: 800, color: item.color, fontFamily: 'monospace', margin: '0 0 2px' }}>{item.value}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{item.sub}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── TEAM (agency only) ── */}
          {activeTab === 'team' && role === 'agency' && (
            <div style={{ animation: 'slideIn 0.2s ease' }}>
              <SectionCard title="Team members" subtitle="Invite your team to manage campaigns together.">
                {/* Invite row */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                  <input
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }}
                    placeholder="colleague@agency.ng"
                    type="email"
                    style={{ ...inputStyle, flex: 1 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail.includes('@')}
                    style={{
                      padding: '9px 18px', background: inviting || !inviteEmail.includes('@') ? '#94A3B8' : '#1B4F8A',
                      color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600,
                      cursor: inviting || !inviteEmail.includes('@') ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    {inviting ? 'Sending...' : 'Send invite'}
                  </button>
                </div>

                {/* Members list */}
                <div style={{ border: '1px solid #F1F5F9', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 80px', padding: '8px 16px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                    {['Member', 'Role', 'Status', ''].map(h => (
                      <span key={h} style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                    ))}
                  </div>
                  {teamMembers.map((member, i) => (
                    <div key={member.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 80px', padding: '12px 16px', borderBottom: i < teamMembers.length - 1 ? '1px solid #F8FAFC' : 'none', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1B4F8A', flexShrink: 0 }}>
                          {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px' }}>{member.name}</p>
                          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{member.email}</p>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.8125rem', color: '#475569' }}>{member.role}</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        background: member.status === 'active' ? '#ECFDF5' : '#FFFBEB',
                        color: member.status === 'active' ? '#065F46' : '#92400E',
                        padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, width: 'fit-content',
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: member.status === 'active' ? '#10B981' : '#F59E0B' }} />
                        {member.status === 'active' ? 'Active' : 'Invited'}
                      </span>
                      {i > 0 && (
                        <button
                          onClick={() => setTeamMembers(prev => prev.filter(m => m.id !== member.id))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Plan & usage" subtitle="Your current subscription and usage limits.">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#0F172A', borderRadius: 12 }}>
                  <div>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px' }}>Current plan</p>
                    <p style={{ fontSize: '1.125rem', fontWeight: 700, color: '#F8FAFC', margin: '0 0 2px' }}>Agency Pro</p>
                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Unlimited campaigns · 10 team seats · Priority support</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#F59E0B', fontFamily: 'monospace', margin: '0 0 2px' }}>₦0</p>
                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Free during beta</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
                  {[
                    { label: 'Active campaigns', used: 0, limit: 'Unlimited' },
                    { label: 'Team members', used: teamMembers.length, limit: '10 seats' },
                    { label: 'Storage', used: '0 MB', limit: '5 GB' },
                  ].map(item => (
                    <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{item.label}</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', margin: '0 0 1px' }}>{item.used}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>of {item.limit}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── BRANDING (agency only) ── */}
          {activeTab === 'branding' && role === 'agency' && (
            <div style={{ animation: 'slideIn 0.2s ease' }}>
              <SectionCard title="Agency branding" subtitle="Customise how your agency appears on client reports, POE decks, and campaign exports.">
                {/* Logo upload */}
                <Field label="Agency logo" hint="Shown in the header of all client-facing reports. PNG or JPG, max 2MB.">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 72, height: 48, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {branding.logoUrl ? (
                        <img src={branding.logoUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt="Logo" />
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                      <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}
                        style={{ background: uploadingLogo ? '#F1F5F9' : '#fff', border: '1px solid #E2E8F0', borderRadius: 7, padding: '7px 14px', fontSize: '0.8125rem', fontWeight: 600, color: uploadingLogo ? '#94A3B8' : '#374151', cursor: uploadingLogo ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                        {uploadingLogo ? 'Uploading…' : branding.logoUrl ? 'Replace logo' : 'Upload logo'}
                      </button>
                      {branding.logoUrl && (
                        <button onClick={() => setBranding(b => ({ ...b, logoUrl: '' }))}
                          style={{ background: 'none', border: '1px solid #FECACA', borderRadius: 7, padding: '7px 12px', fontSize: '0.8125rem', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Input value={branding.logoUrl} onChange={v => setBranding(b => ({ ...b, logoUrl: v }))} placeholder="Or paste a logo URL" />
                    </div>
                  </div>
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Company website">
                    <Input value={branding.companyWebsite} onChange={v => setBranding(b => ({ ...b, companyWebsite: v }))} placeholder="https://youragency.ng" />
                  </Field>
                  <Field label="Tagline" hint="Short phrase shown on reports and POE decks.">
                    <Input value={branding.tagline} onChange={v => setBranding(b => ({ ...b, tagline: v }))} placeholder="e.g. Nigeria's Premium OOH Partner" />
                  </Field>
                </div>

                <Field label="Brand accent colour" hint="Used on POE decks, reports, and campaign exports.">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      type="color"
                      value={branding.accentColor}
                      onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                      style={{ width: 44, height: 40, border: '1.5px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', padding: 2 }}
                    />
                    <input
                      type="text"
                      value={branding.accentColor}
                      onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                      placeholder="#1B4F8A"
                      style={{ ...inputStyle, width: 140 }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['#1B4F8A', '#7C3AED', '#059669', '#DC2626', '#D97706', '#0F172A'].map(c => (
                        <button
                          key={c}
                          onClick={() => setBranding(b => ({ ...b, accentColor: c }))}
                          style={{
                            width: 24, height: 24, borderRadius: '50%', background: c, border: branding.accentColor === c ? '2px solid #0F172A' : '2px solid transparent',
                            cursor: 'pointer', outline: 'none', transition: 'transform 0.1s',
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1.15)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1)'}
                        />
                      ))}
                    </div>
                  </div>
                </Field>

                {/* Preview */}
                <div style={{ border: '1px solid #E8EDF2', borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ background: '#F8FAFC', padding: '10px 14px', borderBottom: '1px solid #F1F5F9' }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>Preview — POE deck header</p>
                  </div>
                  <div style={{ padding: '20px 24px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {branding.logoUrl ? (
                        <img src={branding.logoUrl} style={{ height: 36, maxWidth: 120, objectFit: 'contain' }} alt="Logo preview" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div style={{ width: 8, height: 32, background: branding.accentColor, borderRadius: 2 }} />
                      )}
                      <div>
                        <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{profile.company || 'Your Agency'}</p>
                        <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{branding.tagline || 'Campaign Performance Report'}</p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px' }}>{branding.companyWebsite || 'www.youragency.ng'}</p>
                      <p style={{ fontSize: '0.625rem', color: '#CBD5E1', margin: 0 }}>Powered by OOH Platform</p>
                    </div>
                  </div>
                  <div style={{ height: 4, background: branding.accentColor }} />
                </div>

                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <SaveButton onClick={handleSave} saving={saving} saved={saved} />
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── SECURITY ── */}
          {activeTab === 'security' && (
            <div style={{ animation: 'slideIn 0.2s ease' }}>
              <SectionCard title="Change password" subtitle="Keep your account secure with a strong password.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Field label="Current password">
                    <Input value={currentPw} onChange={setCurrentPw} type="password" placeholder="••••••••" />
                  </Field>
                  <Field label="New password" hint="Minimum 8 characters.">
                    <Input value={newPw} onChange={setNewPw} type="password" placeholder="••••••••" />
                  </Field>
                  <Field label="Confirm new password">
                    <Input value={confirmPw} onChange={setConfirmPw} type="password" placeholder="••••••••" />
                  </Field>
                </div>

                {pwError && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginTop: 14 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <p style={{ fontSize: '0.8125rem', color: '#991B1B', margin: 0 }}>{pwError}</p>
                  </div>
                )}

                {pwSuccess && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '10px 14px', marginTop: 14 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <p style={{ fontSize: '0.8125rem', color: '#065F46', fontWeight: 600, margin: 0 }}>Password updated successfully.</p>
                  </div>
                )}

                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleChangePassword}
                    disabled={changingPw || !currentPw || !newPw || !confirmPw}
                    style={{
                      padding: '9px 20px', borderRadius: 8, border: 'none', fontFamily: 'inherit',
                      fontSize: '0.875rem', fontWeight: 600, cursor: changingPw || !currentPw || !newPw || !confirmPw ? 'not-allowed' : 'pointer',
                      background: changingPw || !currentPw || !newPw || !confirmPw ? '#CBD5E1' : '#1B4F8A',
                      color: '#fff', display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    {changingPw ? (
                      <>
                        <div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        Updating…
                      </>
                    ) : 'Update password'}
                  </button>
                </div>
              </SectionCard>

              <SectionCard title="Active sessions" subtitle="Devices and browsers currently signed in to your account.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>This browser · Lagos, Nigeria</p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Current session · Active now</p>
                  </div>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '3px 9px', borderRadius: 999 }}>Current</span>
                </div>
              </SectionCard>

              <SectionCard title="Danger zone" subtitle="Irreversible account actions.">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', border: '1px solid #FECACA', borderRadius: 10, background: '#FFF7F7' }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Delete account</p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Permanently remove your account and all data. Cannot be undone.</p>
                  </div>
                  <button
                    disabled
                    style={{ padding: '8px 16px', background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, cursor: 'not-allowed', fontFamily: 'inherit' }}
                  >
                    Delete account
                  </button>
                </div>
              </SectionCard>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
