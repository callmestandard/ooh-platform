export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role: 'agency' | 'client' | 'owner'
  company?: string
  created_at: string
}

export interface Campaign {
  id: string
  agency_id?: string
  client_id?: string
  name: string
  client_name?: string
  start_date: string
  end_date: string
  total_budget: number
  status: 'draft' | 'active' | 'completed' | 'cancelled' | 'pending'
  boards_count?: number        // computed client-side, not from DB
  compliance_rate?: number     // computed client-side, not from DB
  plan_notes?: string | null
  approved_at?: string | null
  approved_by?: string | null
  created_at: string
}

export interface Board {
  id: string
  owner_id: string
  name: string
  address: string
  state: string
  latitude?: number
  longitude?: number
  width?: number
  height?: number
  format: string
  asking_rate: number
  photos?: string[]
  status: 'available' | 'booked' | 'maintenance'
  created_at: string
}

export interface Booking {
  id: string
  campaign_id: string
  board_id: string
  offered_rate?: number
  agreed_rate?: number
  status: 'pending' | 'negotiating' | 'agreed' | 'signed' | 'live' | 'complete' | 'declined'
  contract_url?: string
  board?: Board
  created_at: string
}

export interface Message {
  id: string
  booking_id: string
  sender_id: string
  sender_name?: string
  content: string
  created_at: string
}

export interface ComplianceCheck {
  id: string
  booking_id: string
  photo_url?: string
  latitude?: number
  longitude?: number
  submitted_by: string
  status: 'submitted' | 'verified' | 'flagged'
  created_at: string
}

export interface Invoice {
  id: string
  invoice_number: string
  invoice_type?: 'media_partner' | 'client'
  campaign_id?: string
  owner_id?: string
  agency_id?: string
  compiled_invoice_id?: string | null
  client_name: string
  client_email?: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  status: 'draft' | 'sent' | 'acknowledged' | 'paid' | 'overdue' | 'cancelled'
  due_date?: string
  paid_at?: string
  payment_ref?: string
  payment_url?: string
  notes?: string
  created_at: string
  // joined
  campaign?: { id: string; name: string }
  items?: InvoiceItem[]
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  booking_id?: string
  description: string
  board_name?: string
  board_format?: string
  location?: string
  start_date?: string
  end_date?: string
  quantity: number
  unit_price: number
  total: number
  created_at: string
}

export interface AudienceProfile {
  id: string
  board_id: string
  area_type: string
  area_icon: string
  area_description: string
  commercial_score: number
  footfall_score: number
  youth_score: number
  premium_score: number
  daily_impressions: number
  top_pois: { label: string; icon: string; count: number }[]
  verticals: string[]
  total_pois: number
  ai_insight: string | null
  data_source: 'live' | 'estimated'
  enriched_at: string
}