'use client';

import { teamWhatsAppLink } from '@/lib/public-links';

/**
 * Floating "Chat with us" button that opens WhatsApp to the platform team
 * (never to a board owner). Hidden when no team number is set.
 */
export default function WhatsAppButton({ message, bottom = 20 }: { message?: string; bottom?: number }) {
  const href = teamWhatsAppLink(message || "Hi, I found you on OOH Platform. I'd like help finding billboards for a campaign.");
  if (!href) return null;
  return (
    <>
      <style>{`
        .wa-float { position: fixed; right: 20px; z-index: 900; display: flex; align-items: center; gap: 8px;
          background: #25D366; color: #fff; text-decoration: none; border-radius: 999px; padding: 12px 18px 12px 14px;
          font: 600 14px/1 'Inter', system-ui, sans-serif; box-shadow: 0 10px 28px -8px rgba(18,140,74,.6); transition: transform .15s, box-shadow .15s; }
        .wa-float:hover { transform: translateY(-2px); box-shadow: 0 14px 32px -8px rgba(18,140,74,.7); }
        @media (max-width: 640px) { .wa-float { right: 14px; padding: 13px; } .wa-float span { display: none; } }
        @media print { .wa-float { display: none; } }
      `}</style>
      <a href={href} target="_blank" rel="noopener noreferrer" className="wa-float" data-whatsapp-team style={{ bottom }}
        aria-label="Chat with our team on WhatsApp">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.48-1.77-1.66-2.07-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.38 9.38 0 0 1-1.44-5c0-5.2 4.23-9.43 9.44-9.43a9.4 9.4 0 0 1 9.43 9.44c0 5.2-4.23 9.42-9.44 9.42m8.03-17.45A11.27 11.27 0 0 0 12.05.72C5.8.72.7 5.8.7 12.07c0 2 .52 3.95 1.52 5.67L.6 23.6l6-1.57a11.32 11.32 0 0 0 5.43 1.38h.01c6.26 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.32-8.02" />
        </svg>
        <span>Chat with us</span>
      </a>
    </>
  );
}
