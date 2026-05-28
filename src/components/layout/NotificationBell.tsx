'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { markAllRead, markOneRead, NOTIF_ICONS, type Notification } from '@/lib/notifications';
import type { DemoRole } from '@/lib/constants';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

type Props = { role: DemoRole };

export default function NotificationBell({ role }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [role]);

  // Real-time subscription — new rows for this role appear instantly
  useEffect(() => {
    const channel = supabase
      .channel(`notifs-${role}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_role=eq.${role}`,
      }, payload => {
        setNotifications(prev => [payload.new as Notification, ...prev].slice(0, 30));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_role', role)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setNotifications(data as Notification[]);
  }

  async function handleNotifClick(notif: Notification) {
    // Mark read
    if (!notif.read) {
      await markOneRead(notif.id);
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
      );
    }
    setOpen(false);
    if (notif.link) router.push(notif.link);
  }

  async function handleMarkAllRead() {
    await markAllRead(role);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Notifications"
        style={{
          position: 'relative',
          background: open ? 'rgba(255,255,255,0.1)' : 'none',
          border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)', padding: '6px',
          borderRadius: '8px', display: 'flex', alignItems: 'center',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#EF4444', color: '#fff',
            borderRadius: '999px', fontSize: '0.5625rem', fontWeight: 700,
            minWidth: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
            boxShadow: '0 0 0 2px #0F172A',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 64, left: 248,
          width: 320, background: '#fff',
          borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
          zIndex: 100, overflow: 'hidden',
          animation: 'notifFadeIn 0.15s ease',
        }}>
          <style>{`@keyframes notifFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid #F1F5F9',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A' }}>Notifications</span>
              {unreadCount > 0 && (
                <span style={{ background: '#EFF6FF', color: '#1E3A8A', borderRadius: '999px', padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 700 }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, fontFamily: 'inherit' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>🔔</div>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 2px', fontWeight: 500 }}>All caught up</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Notifications will appear here</p>
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  style={{
                    display: 'flex', gap: 10, padding: '10px 14px',
                    cursor: notif.link ? 'pointer' : 'default',
                    background: notif.read ? '#fff' : '#F0F7FF',
                    borderBottom: '1px solid #F8FAFC',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = notif.read ? '#F8FAFC' : '#E0EFFE'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = notif.read ? '#fff' : '#F0F7FF'; }}
                >
                  {/* Icon */}
                  <div style={{
                    width: 32, height: 32, borderRadius: '8px',
                    background: notif.read ? '#F1F5F9' : '#DBEAFE',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.875rem', flexShrink: 0,
                  }}>
                    {NOTIF_ICONS[notif.type] || '🔔'}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: '0.8125rem', fontWeight: notif.read ? 400 : 600,
                      color: '#0F172A', margin: '0 0 2px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {notif.body}
                      </p>
                    )}
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                      {timeAgo(notif.created_at)}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {!notif.read && (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1B4F8A', flexShrink: 0, marginTop: 6 }} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
