const pulse: React.CSSProperties = {
  background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeleton-pulse 1.4s ease-in-out infinite',
  borderRadius: 6,
};

export function Skeleton({ width = '100%', height = 16, style }: {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}) {
  return (
    <>
      <div style={{ width, height, ...pulse, ...style }} />
      <style>{`@keyframes skeleton-pulse { 0%,100%{background-position:200% 0} 50%{background-position:-200% 0} }`}</style>
    </>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
      padding: '20px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <Skeleton height={20} width="60%" />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 2 ? '40%' : '85%'} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ cols = 3, rows = 2 }: { cols?: number; rows?: number }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 16,
    }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 12, padding: '12px 16px', background: '#F8FAFC',
        borderBottom: '1px solid #E2E8F0',
      }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} height={12} width="70%" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12, padding: '14px 16px',
          borderBottom: r < rows - 1 ? '1px solid #F1F5F9' : 'none',
        }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={14} width={c === 0 ? '80%' : '55%'} />
          ))}
        </div>
      ))}
    </div>
  );
}
