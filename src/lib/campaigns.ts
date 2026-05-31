import { supabase } from './supabase'
import { Campaign } from './types'

async function getMyId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function getCampaigns(): Promise<Campaign[]> {
  const uid = await getMyId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('agency_id', uid)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching campaigns:', JSON.stringify(error));
    return [];
  }
  return data || [];
}

export async function createCampaign(campaign: {
  name: string
  client_name: string
  start_date: string
  end_date: string
  total_budget: number
  status: 'draft' | 'active'
}): Promise<Campaign | null> {
  const uid = await getMyId();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      ...campaign,
      agency_id: uid,
    })
    .select()
    .single();
  if (error) {
    console.error('Error creating campaign:', error);
    return null;
  }
  return data;
}

export async function updateCampaignStatus(
  id: string,
  status: Campaign['status']
): Promise<boolean> {
  const { error } = await supabase
    .from('campaigns')
    .update({ status })
    .eq('id', id);
  if (error) {
    console.error('Error updating campaign:', error);
    return false;
  }
  return true;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('Error deleting campaign:', error);
    return false;
  }
  return true;
}
