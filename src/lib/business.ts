// The business details printed on invoices and legal pages.
// Nothing here is made up: a detail that hasn't been configured is left out.
// Set these in Vercel once they are confirmed:
//   BUSINESS_LEGAL_NAME, BUSINESS_RC_NUMBER, BUSINESS_ADDRESS,
//   BANK_NAME, BANK_ACCOUNT, BANK_ACCOUNT_NAME (all three, or no bank is shown)

import { TEAM_WHATSAPP } from './public-links';

const env = (k: string) => (process.env[k] || '').trim() || null;

export const BUSINESS = {
  name: env('BUSINESS_LEGAL_NAME') ?? 'OOH Platform',
  rcNumber: env('BUSINESS_RC_NUMBER'),
  address: env('BUSINESS_ADDRESS') ?? 'Lagos, Nigeria',
  /** Shown as +234…, the team line already public on the site. */
  phone: TEAM_WHATSAPP ? `+${TEAM_WHATSAPP}` : null,
};

/** Only when every bank detail is configured; a partial or default account is never printed. */
export function bankDetails(): { bank: string; account: string; accountName: string } | null {
  const bank = env('BANK_NAME'), account = env('BANK_ACCOUNT'), accountName = env('BANK_ACCOUNT_NAME');
  return bank && account && accountName ? { bank, account, accountName } : null;
}

export const NO_BANK_TEXT =
  'Our team will send you confirmed payment details. Do not pay into any account that our team has not confirmed with you directly.';
