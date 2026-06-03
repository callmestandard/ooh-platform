import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OOH Platform',
    short_name: 'OOH',
    description: "Nigeria's operating system for outdoor advertising",
    start_url: '/auth/login',
    display: 'standalone',
    background_color: '#0A1628',
    theme_color: '#1B4F8A',
    orientation: 'portrait-primary',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Dashboard',    short_name: 'Home',    url: '/dashboard/agency',              icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }] },
      { name: 'Negotiations', short_name: 'Deals',   url: '/dashboard/agency/negotiations', icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }] },
      { name: 'Find Boards',  short_name: 'Boards',  url: '/dashboard/agency/marketplace',  icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }] },
    ],
  };
}
