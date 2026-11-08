// MVP launch mode: the platform runs as a curated marketplace (discover →
// request → quote → agree), and our team completes bookings by hand. Advanced
// tools (MPOs, contracts, invoices, call logging, direct owner contact) stay
// in the code but are hidden. Set NEXT_PUBLIC_MVP_MODE=false to show them.
export const MVP_MODE = process.env.NEXT_PUBLIC_MVP_MODE !== 'false';

export const MVP_HANDOFF_TEXT = 'Request accepted. Our team will contact you to complete the booking.';
