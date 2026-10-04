'use client';

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

/**
 * Google Street View for a point. With NEXT_PUBLIC_GOOGLE_MAPS_KEY set (a
 * key with the Maps Embed API enabled) the panorama is embedded and can be
 * walked in place; without one it falls back to a button that opens Google
 * Street View in a new tab — a plain Maps URL, which needs no key.
 */
export default function StreetLevelView({ lat, lng, height = 400 }: { lat: number; lng: number; height?: number }) {
  const openInGoogleStreetView = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;

  return (
    <div data-street-level={GOOGLE_MAPS_KEY ? 'embed' : 'link'} style={{ display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif" }}>
      {GOOGLE_MAPS_KEY ? (
        <iframe
          key={`${lat},${lng}`}
          src={`https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&location=${lat},${lng}&heading=0&pitch=0&fov=90`}
          title="Google Street View"
          style={{ width: '100%', height, border: 'none', display: 'block' }}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, textAlign: 'center', background: '#F8FAFC', boxSizing: 'border-box' }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>See this street on Google Street View</p>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0, maxWidth: 260, lineHeight: 1.5 }}>
            Opens in a new tab at this location. Imagery is historical and not available on every road.
          </p>
        </div>
      )}

      <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
        <a
          href={openInGoogleStreetView}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none' }}
        >
          View on Google Street View ↗
        </a>
      </div>
    </div>
  );
}
