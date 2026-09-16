'use client';

import { useRouter } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import BoardForm from '../BoardForm';

function NewBoardContent() {
  const router = useRouter();
  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => router.push('/dashboard/agency/boards')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0, fontFamily: 'inherit', fontSize: '0.8125rem', marginBottom: 8, display: 'block' }}
        >
          ← Boards
        </button>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
          Add board to inventory
        </h1>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
          Enter a board you&apos;ve sourced directly — no partner sign-up required.
        </p>
      </div>
      <BoardForm
        onSaved={(id) => router.push(`/dashboard/agency/boards/${id}/edit`)}
        onCancel={() => router.push('/dashboard/agency/boards')}
      />
    </div>
  );
}

export default function NewBoardPage() {
  return (
    <RoleGuard role="agency">
      <NewBoardContent />
    </RoleGuard>
  );
}
