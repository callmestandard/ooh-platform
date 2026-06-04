import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OOH Platform — Nigeria Billboard Marketplace',
  description: 'Browse available billboard space across Nigeria. Filter by city, format, and price. Make offers directly to board owners.',
  openGraph: {
    title: 'OOH Platform — Nigeria Billboard Marketplace',
    description: 'Browse available billboard space across Nigeria. Lagos, Abuja, Port Harcourt and more. Filter by format and price, make offers directly.',
    type: 'website',
    siteName: 'OOH Platform',
    images: [
      {
        url: '/og-marketplace.png',
        width: 1200,
        height: 630,
        alt: 'OOH Platform — Nigeria Billboard Marketplace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OOH Platform — Nigeria Billboard Marketplace',
    description: 'Browse available billboard space across Nigeria.',
  },
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
