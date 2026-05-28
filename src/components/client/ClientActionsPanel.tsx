'use client';

export type ClientAction = {
  id: string;
  title: string;
  description: string;
  cta: string;
  urgency: 'high' | 'medium' | 'low';
  onClick: () => void;
};

type Props = {
  actions: ClientAction[];
};

export function ClientActionsPanel({ actions }: Props) {
  if (actions.length === 0) return null;

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
          Needs your attention
        </p>
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999 }}>
          {actions.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.map((action, i) => {
          const border = action.urgency === 'high' ? '#FECACA' : action.urgency === 'medium' ? '#FDE68A' : '#E2E8F0';
          const bg = action.urgency === 'high' ? '#FEF2F2' : action.urgency === 'medium' ? '#FFFBEB' : '#fff';
          return (
            <div
              key={action.id}
              className="fade"
              style={{
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                animationDelay: `${i * 0.04}s`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{action.title}</p>
                <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>{action.description}</p>
              </div>
              <button
                type="button"
                onClick={action.onClick}
                style={{
                  flexShrink: 0,
                  padding: '8px 14px',
                  background: action.urgency === 'high' ? '#EF4444' : '#1B4F8A',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {action.cta}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
