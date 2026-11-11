import type { Metadata } from 'next';

// Proposal links are private to whoever holds them; keep them out of search.
export const metadata: Metadata = {
  title: 'Billboard proposal · OOH Platform',
  robots: { index: false, follow: false },
};

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
