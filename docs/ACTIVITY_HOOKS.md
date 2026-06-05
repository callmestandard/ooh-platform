# Activity audit log — hook map

**Migration:** `supabase-add-activity-events.sql` (run in Supabase SQL Editor)  
**Library:** `src/lib/activity-log.ts`

## Wired

| Location | Action |
|----------|--------|
| `PATCH /api/invoices/[id]` | `invoice.updated`, `invoice.paid`, `invoice.cancelled` |
| `POST /api/invoices/compile` | `invoice.compiled`, `invoice.mpi_acknowledged` |
| `POST /api/paystack/webhook` | `invoice.paid` |
| `PATCH /api/invoices/media-partner` | `invoice.mpi_updated` |
| `POST /api/invoices` | `invoice.created` |
| `POST /api/invoices/media-partner` | `invoice.mpi_created` |
| Agency compliance page | `compliance.verified`, `compliance.flagged` |
| `BookingRequestPanel` | `booking.requested` |
| Agency + owner negotiation `sendMessage` | `booking.status_changed`, `booking.message_sent` |
| Agency negotiation `handleRaiseMPO` | `booking.mpo_raised` |
| Campaign plan page | `campaign.sent_for_approval`, `campaign.arcon_updated`, `campaign.status_changed`, `booking.added_to_plan`, `booking.removed_from_plan`, `booking.rate_updated` |
| Client portal approve/decline | `booking.approved_by_client`, `booking.declined_by_client` |
| POE submit | `compliance.submitted`, `booking.status_changed` → live |

## UI

| Page | Component |
|------|-----------|
| `/dashboard/agency/invoices/[id]` | `ActivityTimeline` |
| `/dashboard/agency/campaigns/[id]` → Activity tab | `CampaignActivityTimeline` |
| `/dashboard/agency/negotiations/[id]` | `ActivityTimeline` (sidebar) |

## Optional next

- Paystack payment link created (`invoice.payment_link_created`)
- Marketplace direct booking insert (same as `booking.requested`)
- Campaign planner bulk insert bookings
