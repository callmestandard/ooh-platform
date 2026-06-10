'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatNaira } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  city: string;
  state: string | null;
  format: string;
  asking_rate: number;
  status: 'available' | 'booked' | 'maintenance';
};

type Booking = {
  id: string;
  board_id: string;
  campaign_id: string;
  status: string;
  start_date: string;
  end_date: string;
  agreed_rate: number | null;
  offered_rate: number;
  campaigns: { name: string; client_name: string | null };
};

type CalendarCell = {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};


function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function buildCalendar(year: number, month: number): CalendarCell[] {
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const cells: CalendarCell[] = [];

  // Pad start with previous month days
  const startDow = firstDay.getDay(); // 0=Sun
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, isCurrentMonth: false, isToday: false });
  }

  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    cells.push({
      date,
      isCurrentMonth: true,
      isToday: isoDate(date) === isoDate(today),
    });
  }

  // Pad end
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(year, month + 1, i);
    cells.push({ date: d, isCurrentMonth: false, isToday: false });
  }

  return cells;
}

function getBookingsForDate(bookings: Booking[], date: Date): Booking[] {
  const ds = isoDate(date);
  return bookings.filter(b => {
    if (!['pending', 'negotiating', 'agreed', 'signed', 'live'].includes(b.status)) return false;
    return b.start_date <= ds && b.end_date >= ds;
  });
}

// ── Booking bar colors ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: '#FDE68A', text: '#92400E' },
  negotiating: { bg: '#BFDBFE', text: '#1E3A8A' },
  agreed:      { bg: '#C4B5FD', text: '#3730A3' },
  signed:      { bg: '#C4B5FD', text: '#3730A3' },
  live:        { bg: '#6EE7B7', text: '#065F46' },
};

// ── Timeline view component ───────────────────────────────────────────────────

function TimelineView({ boards, bookings, viewStart }: { boards: Board[]; bookings: Booking[]; viewStart: Date }) {
  const days = 30;
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(viewStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  const today = isoDate(new Date());

  function getSegment(boardId: string, date: Date) {
    const ds = isoDate(date);
    return bookings.find(b => b.board_id === boardId && b.start_date <= ds && b.end_date >= ds && ['pending','negotiating','agreed','signed','live'].includes(b.status));
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: boards.length === 0 ? 'auto' : 900 }}>
        {/* Header row */}
        <div style={{ display: 'flex', borderBottom: '2px solid #E8EDF2', marginBottom: 0 }}>
          <div style={{ width: 220, flexShrink: 0, padding: '8px 16px', background: '#F8FAFC', borderRight: '1px solid #E8EDF2' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Board</span>
          </div>
          <div style={{ display: 'flex', flex: 1 }}>
            {dates.map((d, i) => {
              const ds = isoDate(d);
              const isToday = ds === today;
              return (
                <div key={i} style={{
                  flex: 1, minWidth: 28, textAlign: 'center', padding: '4px 0',
                  background: isToday ? '#EFF6FF' : i % 2 === 0 ? '#FAFAFA' : '#fff',
                  borderRight: '1px solid #F1F5F9',
                  borderBottom: isToday ? '2px solid #1B4F8A' : 'none',
                }}>
                  <p style={{ fontSize: '0.5625rem', fontWeight: isToday ? 700 : 400, color: isToday ? '#1B4F8A' : '#94A3B8', margin: 0 }}>
                    {d.getDate()}
                  </p>
                  {i === 0 || d.getDate() === 1 ? (
                    <p style={{ fontSize: '0.5rem', color: '#CBD5E1', margin: 0 }}>
                      {d.toLocaleDateString('en-NG', { month: 'short' })}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Board rows */}
        {boards.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.875rem' }}>No boards in inventory</div>
        ) : boards.map((board, bi) => {
          return (
            <div key={board.id} style={{ display: 'flex', borderBottom: '1px solid #F1F5F9', minHeight: 40 }}>
              <div style={{ width: 220, flexShrink: 0, padding: '8px 16px', background: bi % 2 === 0 ? '#FAFAFA' : '#fff', borderRight: '1px solid #E8EDF2', display: 'flex', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 188 }}>{board.name}</p>
                  <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: 0 }}>{board.city}</p>
                </div>
              </div>
              <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
                {dates.map((d, i) => {
                  const seg = getSegment(board.id, d);
                  const ds = isoDate(d);
                  const isToday = ds === today;
                  const colors = seg ? STATUS_COLORS[seg.status] || { bg: '#E2E8F0', text: '#475569' } : null;

                  // Only render booking label at start
                  const isStart = seg && seg.start_date === ds;
                  const isEnd   = seg && seg.end_date === ds;

                  return (
                    <div key={i} title={seg ? `${seg.campaigns?.name} (${seg.status})` : board.name} style={{
                      flex: 1, minWidth: 28,
                      background: seg ? colors!.bg : (isToday ? '#EFF6FF' : bi % 2 === 0 ? '#FAFAFA' : '#fff'),
                      borderRight: '1px solid #F1F5F9',
                      borderLeft: isStart ? `3px solid ${colors ? colors.text : 'transparent'}` : undefined,
                      borderRadius: isStart ? '4px 0 0 4px' : isEnd ? '0 4px 4px 0' : undefined,
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden',
                      position: 'relative',
                    }}>
                      {isStart && seg && (
                        <span style={{
                          fontSize: '0.5625rem', fontWeight: 700, color: colors!.text,
                          padding: '0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: '100%',
                        }}>
                          {seg.campaigns?.name}
                        </span>
                      )}
                      {isToday && !seg && (
                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: '#1B4F8A', opacity: 0.3 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AvailabilityPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'timeline'>('timeline');
  const [calMonth, setCalMonth] = useState(new Date());
  const [selectedBoard, setSelectedBoard] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    try {
      const [boardRes, bookRes] = await Promise.all([
        supabase.from('boards').select('id, name, city, state, format, asking_rate, status').order('name').limit(300),
        supabase.from('bookings').select('id, board_id, campaign_id, status, start_date, end_date, agreed_rate, offered_rate, campaigns(name, client_name)').order('start_date').limit(500),
      ]);
      if (boardRes.error) throw boardRes.error;
      if (bookRes.error) throw bookRes.error;
      setBoards((boardRes.data as Board[]) || []);
      setBookings((bookRes.data as unknown as Booking[]) || []);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load availability data');
    } finally {
      setLoading(false);
    }
  }

  const filteredBoards = boards.filter(b => {
    if (selectedBoard !== 'all' && b.id !== selectedBoard) return false;
    if (filterStatus !== 'all' && b.status !== filterStatus) return false;
    return true;
  });

  const year  = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const cells = buildCalendar(year, month);
  const today = isoDate(new Date());

  const boardIds = filteredBoards.map(b => b.id);
  const relevantBookings = bookings.filter(b => boardIds.includes(b.board_id));

  const occupiedBoardsToday = new Set(
    bookings.filter(b => {
      const ds = today;
      return ['agreed','signed','live'].includes(b.status) && b.start_date <= ds && b.end_date >= ds;
    }).map(b => b.board_id)
  ).size;

  const availableToday = boards.length - occupiedBoardsToday;

  // Upcoming availability gaps (boards becoming free in next 30 days)
  const upcomingFree: { board: Board; freeFrom: string }[] = [];
  boards.forEach(board => {
    const boardBookings = bookings
      .filter(b => b.board_id === board.id && ['agreed','signed','live'].includes(b.status))
      .sort((a, b) => a.end_date.localeCompare(b.end_date));
    const last = boardBookings[boardBookings.length - 1];
    if (last) {
      const freeFrom = new Date(last.end_date);
      freeFrom.setDate(freeFrom.getDate() + 1);
      const daysUntilFree = Math.floor((freeFrom.getTime() - Date.now()) / 86400000);
      if (daysUntilFree >= 0 && daysUntilFree <= 30) {
        upcomingFree.push({ board, freeFrom: isoDate(freeFrom) });
      }
    }
  });

  if (fetchError) return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <p style={{ color: '#EF4444', fontWeight: 600, marginBottom: 12 }}>Failed to load availability data</p>
      <p style={{ color: '#64748B', fontSize: '0.875rem', marginBottom: 16 }}>{fetchError}</p>
      <button onClick={() => { setFetchError(null); setLoading(true); fetchData(); }} style={{ padding: '8px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.875rem' }}>Retry</button>
    </div>
  );

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>Availability</h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>See exactly when every board is free and plan bookings accordingly.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {(['timeline', 'calendar'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: viewMode === mode ? '#fff' : 'transparent',
                  color: viewMode === mode ? '#0F172A' : '#64748B',
                  fontSize: '0.8125rem', fontWeight: viewMode === mode ? 600 : 400,
                  boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => router.push('/dashboard/agency/campaign-planner')}
            style={{ padding: '8px 16px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            + Book boards
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Total boards', value: boards.length, sub: 'In inventory', bar: '#1B4F8A' },
          { label: 'Available today', value: availableToday, sub: 'Ready to book', bar: '#10B981' },
          { label: 'Occupied today', value: occupiedBoardsToday, sub: 'Live / agreed', bar: '#7C3AED' },
          { label: 'Freeing up soon', value: upcomingFree.length, sub: 'Next 30 days', bar: '#F59E0B' },
        ].map(card => (
          <div key={card.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 18px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{card.label}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'block', width: 3, height: 24, background: card.bar, borderRadius: 2 }} />
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>{card.value}</span>
            </div>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem', alignItems: 'center' }}>
        <select
          value={selectedBoard}
          onChange={e => setSelectedBoard(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', color: '#0F172A', outline: 'none', background: '#fff', fontFamily: 'inherit', cursor: 'pointer', minWidth: 200 }}
        >
          <option value="all">All boards</option>
          {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 3, borderRadius: 8 }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'available', label: 'Available' },
            { key: 'booked', label: 'Booked' },
            { key: 'maintenance', label: 'Maintenance' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilterStatus(f.key)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: filterStatus === f.key ? '#fff' : 'transparent',
                color: filterStatus === f.key ? '#0F172A' : '#64748B',
                fontSize: '0.8125rem', fontWeight: filterStatus === f.key ? 600 : 400,
                boxShadow: filterStatus === f.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', alignItems: 'center' }}>
          {Object.entries(STATUS_COLORS).slice(0, 3).map(([status, colors]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: colors.bg, border: `1px solid ${colors.text}40` }} />
              <span style={{ fontSize: '0.6875rem', color: '#94A3B8', textTransform: 'capitalize' }}>{status}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#F1F5F9', border: '1px solid #E2E8F0' }} />
            <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>Free</span>
          </div>
        </div>
      </div>

      {/* Upcoming freeing soon */}
      {upcomingFree.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: '1.25rem', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#92400E' }}>Available soon:</span>
          </div>
          {upcomingFree.slice(0, 5).map(({ board, freeFrom }) => (
            <button
              key={board.id}
              onClick={() => { setSelectedBoard(board.id); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #FDE68A', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A' }}>{board.name}</span>
              <span style={{ fontSize: '0.6875rem', color: '#D97706', fontWeight: 600 }}>free from {new Date(freeFrom).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</span>
            </button>
          ))}
        </div>
      )}

      {/* Timeline / Calendar view */}
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>

        {viewMode === 'timeline' && (
          <>
            {/* Timeline navigation */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => { const d = new Date(calMonth); d.setDate(d.getDate() - 30); setCalMonth(d); }}
                  style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', color: '#475569', fontWeight: 600 }}
                >
                  ← Prev 30d
                </button>
                <button
                  onClick={() => setCalMonth(new Date())}
                  style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600 }}
                >
                  Today
                </button>
                <button
                  onClick={() => { const d = new Date(calMonth); d.setDate(d.getDate() + 30); setCalMonth(d); }}
                  style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', color: '#475569', fontWeight: 600 }}
                >
                  Next 30d →
                </button>
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
                {calMonth.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })} — 30 days
              </p>
            </div>
            <TimelineView boards={filteredBoards} bookings={relevantBookings} viewStart={calMonth} />
          </>
        )}

        {viewMode === 'calendar' && (
          <>
            {/* Calendar nav */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setCalMonth(m => addMonths(m, -1))}
                  style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', color: '#475569', fontWeight: 600 }}
                >
                  ←
                </button>
                <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0, minWidth: 160, textAlign: 'center' }}>
                  {calMonth.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}
                </p>
                <button
                  onClick={() => setCalMonth(m => addMonths(m, 1))}
                  style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', color: '#475569', fontWeight: 600 }}
                >
                  →
                </button>
              </div>
              <button
                onClick={() => setCalMonth(new Date())}
                style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600 }}
              >
                Today
              </button>
            </div>

            {/* Calendar grid */}
            <div style={{ padding: '0 16px 16px' }}>
              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4, marginTop: 12 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 0' }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                {cells.map((cell, i) => {
                  const ds = isoDate(cell.date);
                  const dayBookings = getBookingsForDate(relevantBookings, cell.date);
                  const isSelected = selectedDate && isoDate(selectedDate) === ds;
                  const isWeekend = [0, 6].includes(cell.date.getDay());

                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDate(cell.isCurrentMonth ? cell.date : null)}
                      style={{
                        minHeight: 80, borderRadius: 8, padding: '6px 8px',
                        background: isSelected ? '#EFF6FF' : cell.isToday ? '#F0FDF4' : isWeekend && cell.isCurrentMonth ? '#FAFAFA' : '#fff',
                        border: `1px solid ${isSelected ? '#1B4F8A' : cell.isToday ? '#6EE7B7' : '#F1F5F9'}`,
                        cursor: cell.isCurrentMonth ? 'pointer' : 'default',
                        opacity: cell.isCurrentMonth ? 1 : 0.35,
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { if (cell.isCurrentMonth && !isSelected) (e.currentTarget as HTMLElement).style.background = '#F8FAFC'; }}
                      onMouseLeave={e => { if (cell.isCurrentMonth && !isSelected) (e.currentTarget as HTMLElement).style.background = cell.isToday ? '#F0FDF4' : isWeekend ? '#FAFAFA' : '#fff'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <span style={{
                          fontSize: '0.8125rem', fontWeight: cell.isToday ? 800 : 500,
                          color: cell.isToday ? '#10B981' : isSelected ? '#1B4F8A' : '#0F172A',
                          width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: '50%', background: cell.isToday ? '#ECFDF5' : 'transparent',
                        }}>
                          {cell.date.getDate()}
                        </span>
                        {dayBookings.length > 0 && (
                          <span style={{ fontSize: '0.5625rem', fontWeight: 700, background: '#1B4F8A', color: '#fff', borderRadius: '999px', padding: '1px 5px' }}>
                            {dayBookings.length}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {dayBookings.slice(0, 2).map(b => {
                          const colors = STATUS_COLORS[b.status] || { bg: '#E2E8F0', text: '#475569' };
                          return (
                            <div key={b.id} style={{ background: colors.bg, borderRadius: 3, padding: '1px 5px', overflow: 'hidden' }}>
                              <p style={{ fontSize: '0.5625rem', fontWeight: 600, color: colors.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {b.campaigns?.name}
                              </p>
                            </div>
                          );
                        })}
                        {dayBookings.length > 2 && (
                          <p style={{ fontSize: '0.5625rem', color: '#94A3B8', margin: 0 }}>+{dayBookings.length - 2} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected day panel */}
            {selectedDate && (() => {
              const dayBookings = getBookingsForDate(relevantBookings, selectedDate);
              return (
                <div style={{ borderTop: '1px solid #F1F5F9', padding: '16px 20px', background: '#F8FAFC' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                      {selectedDate.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <button onClick={() => setSelectedDate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '0.875rem' }}>✕</button>
                  </div>
                  {dayBookings.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981' }} />
                      <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0 }}>All boards available on this date</p>
                      <button
                        onClick={() => router.push('/dashboard/agency/campaign-planner')}
                        style={{ marginLeft: 'auto', padding: '6px 14px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Book now
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {dayBookings.map(b => {
                        const board = boards.find(bd => bd.id === b.board_id);
                        const colors = STATUS_COLORS[b.status] || { bg: '#E2E8F0', text: '#475569' };
                        return (
                          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: colors.bg, borderRadius: 8, padding: '8px 12px' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.text, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{board?.name || '—'}</p>
                              <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: 0 }}>{b.campaigns?.name} · {b.status}</p>
                            </div>
                            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: colors.text, fontFamily: 'monospace', margin: 0 }}>
                              {formatNaira(b.agreed_rate || b.offered_rate)}/mo
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
