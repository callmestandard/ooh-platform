"use client";

import Link from "next/link";

type Props = {
  userName: string;
  roleLabel: string;
  onLogout: () => void;
};

function OOHLogo() {
  return (
    <svg width="130" height="30" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A"/>
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill="#ffffff"/>
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A"/>
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill="#ffffff"/>
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A"/>
      <circle cx="88" cy="4" r="3" fill="#F59E0B"/>
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill="#0F172A" letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill="#94A3B8" letterSpacing="3">PLATFORM</text>
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function Navbar({ userName, roleLabel, onLogout }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-200/90 bg-white px-4 md:px-6">
      <Link href="/dashboard/agency" className="flex items-center hover:opacity-80 transition-opacity">
        <OOHLogo />
      </Link>

      <div className="flex items-center gap-3">
        <span className="hidden md:block text-sm text-zinc-600 font-medium">{userName}</span>

        <span style={{
          fontSize: '0.6875rem', fontWeight: 600,
          padding: '3px 10px', borderRadius: '999px',
          background: '#EFF6FF', color: '#1E40AF',
          border: '1px solid #BFDBFE', letterSpacing: '0.03em'
        }}>
          {roleLabel.toUpperCase()}
        </span>

        <button className="relative p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors">
          <BellIcon />
        </button>

        <button
          onClick={onLogout}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-zinc-100"
        >
          Logout
        </button>
      </div>
    </header>
  );
}