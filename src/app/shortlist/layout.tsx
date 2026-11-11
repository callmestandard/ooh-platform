import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your shortlist · OOH Platform',
  robots: { index: false },
};

export default function ShortlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
