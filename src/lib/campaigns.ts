import { supabase } from './supabase'
import { Campaign } from './types'

export async function getCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    if (error) {
      console.error('Error fetching campaigns:', JSON.stringify(error))
      return []
    }
  return data || []
}

export async function createCampaign(campaign: {
    name: string
    client_name: string
    start_date: string
    end_date: string
    total_budget: number
    status: 'draft' | 'active'
  }): Promise<Campaign | null> {
    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        name: campaign.name,
        client_name: campaign.client_name,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        total_budget: campaign.total_budget,
        status: campaign.status,
      })
      .select()
      .single()
    if (error) {
      console.error('Error creating campaign:', error)
      return null
    }
    return data
  }

export async function updateCampaignStatus(
  id: string,
  status: Campaign['status']
): Promise<boolean> {
  const { error } = await supabase
    .from('campaigns')
    .update({ status })
    .eq('id', id)
  if (error) {
    console.error('Error updating campaign:', error)
    return false
  }
  return true
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('Error deleting campaign:', error)
    return false
  }
  return true
}