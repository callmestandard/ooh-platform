'use client';

type Step = {
  id: string;
  label: string;
  detail: string;
  state: 'done' | 'current' | 'upcoming';
};

type Props = {
  steps: Step[];
};

export function CampaignJourneyStrip({ steps }: Props) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px', marginBottom: '1.25rem' }}>
      <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>
        Campaign journey
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
        {steps.map((step, i) => (
          <div key={step.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', minWidth: 0 }}>
            {i < steps.length - 1 && (
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  left: '50%',
                  width: '100%',
                  height: 2,
                  background: step.state === 'done' ? '#10B981' : '#E2E8F0',
                  zIndex: 0,
                }}
              />
            )}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.6875rem',
                fontWeight: 700,
                zIndex: 1,
                background: step.state === 'done' ? '#10B981' : step.state === 'current' ? '#1B4F8A' : '#F1F5F9',
                color: step.state === 'upcoming' ? '#94A3B8' : '#fff',
                border: step.state === 'current' ? '2px solid #BFDBFE' : 'none',
                boxShadow: step.state === 'current' ? '0 0 0 4px rgba(27,79,138,0.12)' : 'none',
              }}
            >
              {step.state === 'done' ? '✓' : i + 1}
            </div>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: step.state === 'current' ? '#1B4F8A' : step.state === 'done' ? '#065F46' : '#64748B', margin: '8px 0 2px', textAlign: 'center' }}>
              {step.label}
            </p>
            <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: 0, textAlign: 'center', lineHeight: 1.3, padding: '0 4px' }}>
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function buildCampaignJourney(params: {
  hasBrief: boolean;
  pendingApprovals: number;
  agreedBoards: number;
  liveBoards: number;
  verifiedPoe: number;
  totalBoards: number;
  unpaidInvoices: number;
}): Step[] {
  const { hasBrief, pendingApprovals, agreedBoards, liveBoards, verifiedPoe, totalBoards, unpaidInvoices } = params;

  const planDone = pendingApprovals === 0 && agreedBoards > 0;
  const liveDone = liveBoards > 0;
  const poeDone = totalBoards > 0 && verifiedPoe >= totalBoards * 0.9;
  const paidDone = unpaidInvoices === 0 && totalBoards > 0;

  return [
    {
      id: 'brief',
      label: 'Brief',
      detail: hasBrief ? 'Submitted' : 'Create campaign',
      state: hasBrief ? 'done' : 'current',
    },
    {
      id: 'plan',
      label: 'Approve plan',
      detail: pendingApprovals > 0 ? `${pendingApprovals} awaiting` : planDone ? `${agreedBoards} boards` : 'Waiting on agency',
      state: pendingApprovals > 0 ? 'current' : planDone ? 'done' : hasBrief ? 'upcoming' : 'upcoming',
    },
    {
      id: 'live',
      label: 'Go live',
      detail: liveBoards > 0 ? `${liveBoards} live` : 'Booking sites',
      state: liveDone ? 'done' : planDone ? 'current' : 'upcoming',
    },
    {
      id: 'poe',
      label: 'Verify POE',
      detail: totalBoards > 0 ? `${verifiedPoe}/${totalBoards} verified` : 'Proof of posting',
      state: poeDone ? 'done' : liveDone ? 'current' : 'upcoming',
    },
    {
      id: 'pay',
      label: 'Settle',
      detail: unpaidInvoices > 0 ? `${unpaidInvoices} invoice${unpaidInvoices > 1 ? 's' : ''} due` : paidDone ? 'Paid' : 'When invoiced',
      state: unpaidInvoices > 0 ? 'current' : paidDone ? 'done' : 'upcoming',
    },
  ];
}
