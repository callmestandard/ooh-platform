'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastAPI = {
  toast: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastAPI | null>(null);

const ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
};

const COLORS: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  success: { bg: '#F0FDF4', border: '#16A34A', icon: '#16A34A' },
  error:   { bg: '#FEF2F2', border: '#DC2626', icon: '#DC2626' },
  info:    { bg: '#EFF6FF', border: '#1B4F8A', icon: '#1B4F8A' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = ++nextId.current;
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => remove(id), 3500);
  }, [remove]);

  const api: ToastAPI = {
    toast,
    success: (msg) => toast(msg, 'success'),
    error:   (msg) => toast(msg, 'error'),
    info:    (msg) => toast(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => {
          const c = COLORS[t.variant];
          return (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: c.bg,
                border: `1.5px solid ${c.border}`,
                borderRadius: 10,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                minWidth: 240,
                maxWidth: 360,
                pointerEvents: 'auto',
                animation: 'toast-in 0.2s ease',
              }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: c.icon, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {ICONS[t.variant]}
              </span>
              <span style={{ fontSize: '0.8125rem', color: '#0F172A', fontWeight: 500, lineHeight: 1.4 }}>
                {t.message}
              </span>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
