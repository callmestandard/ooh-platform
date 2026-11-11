import type { Metadata } from 'next';

// Owner links are private to the owner; keep them out of search.
export const metadata: Metadata = {
  title: 'Your boards · OOH Platform',
  robots: { index: false, follow: false },
};

export default function OwnerLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
