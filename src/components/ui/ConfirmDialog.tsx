'use client';

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  const confirmBg = variant === 'danger' ? '#A32D2D' : '#1B4F8A';
  const confirmHover = variant === 'danger' ? '#862525' : '#164070';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(15,23,42,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14, padding: '28px 28px 24px',
          width: '100%', maxWidth: 420,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {variant === 'danger' && (
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: '#FEF2F2', display: 'flex', alignItems: 'center',
            justifyContent: 'center', marginBottom: 16,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}
        <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
          {title}
        </h3>
        {description && (
          <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#64748B', lineHeight: 1.5 }}>
            {description}
          </p>
        )}
        {!description && <div style={{ marginBottom: 24 }} />}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '9px 18px', borderRadius: 8, border: '1px solid #E2E8F0',
              background: '#fff', color: '#374151', fontSize: '0.875rem',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: confirmBg, color: '#fff', fontSize: '0.875rem',
              fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = confirmHover; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = confirmBg; }}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
