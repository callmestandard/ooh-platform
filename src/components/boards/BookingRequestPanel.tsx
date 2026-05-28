'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type Board = {
  id: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  format?: string;
  asking_rate?: number;
  width?: number;
  height?: number;
  photos?: string[];
  status: string;
};

type Campaign = {
  id: string;
  name: string;
  client_name?: string;
  status: string;
};

type Props = {
  board: Board;
  onClose: () => void;
  onSuccess: () => void;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatNaira(amount?: number | null) {
  if (!amount) return '—';
  return '₦' + Number(amount).toLocaleString('en-NG');
}

export default function BookingRequestPanel({ board, onClose, onSuccess }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [offeredRate, setOfferedRate] = useState(
    board.asking_rate ? Math.round(board.asking_rate * 0.85) : 0
  );
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCampaigns();
    // Default dates: 7 days from now, 37 days from now
    const start = new Date();
    start.setDate(start.getDate() + 7);
    const end = new Date();
    end.setDate(end.getDate() + 37);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, []);

  async function fetchCampaigns() {
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, client_name, status')
      .in('status', ['active', 'draft'])
      .order('created_at', { ascending: false });
    if (data) setCampaigns(data as Campaign[]);
    if (data && data.length > 0) setSelectedCampaign(data[0].id);
  }

  async function handleSubmit() {
    setError('');
    if (!selectedCampaign) { setError('Please select a campaign'); return; }
    if (!offeredRate || offeredRate <= 0) { setError('Please enter a valid rate'); return; }
    if (!startDate || !endDate) { setError('Please set campaign dates'); return; }
    if (new Date(endDate) <= new Date(startDate)) { setError('End date must be after start date'); return; }

    setSubmitting(true);

    const { error: insertError } = await supabase.from('bookings').insert({
      campaign_id: selectedCampaign,
      board_id: board.id,
      offered_rate: offeredRate,
      status: 'pending',
      start_date: startDate,
      end_date: endDate,
      notes: notes || null,
    });

    if (insertError) {
      console.error(insertError);
      setError('Failed to send request. Please try again.');
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
    setTimeout(() => {
      onSuccess();
    }, 2000);
  }

  const discount = board.asking_rate
    ? Math.round(((board.asking_rate - offeredRate) / board.asking_rate) * 100)
    : 0;

  if (submitted) {
    return (
      <div className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center">
          <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Booking request sent!</p>
          <p className="text-xs text-gray-500 mt-1">
            The board owner will be notified. You can track this in Negotiations.
          </p>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden">
          <div className="bg-green-500 h-1 rounded-full animate-[width_2s_ease-in-out]" style={{ width: '100%', transition: 'width 2s' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#1B4F8A] uppercase tracking-wider mb-1">
            Booking request
          </p>
          <h3 className="text-sm font-semibold text-gray-900 leading-tight truncate">
            {board.name}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{board.address}</p>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-sm"
        >
          ✕
        </button>
      </div>

      {/* Board summary */}
      <div className="mx-4 mt-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-gray-400">Format</p>
            <p className="text-xs font-semibold text-gray-800 mt-0.5">
              {FORMAT_LABELS[board.format || ''] || board.format || '—'}
            </p>
          </div>
          <div className="border-x border-gray-200">
            <p className="text-xs text-gray-400">Location</p>
            <p className="text-xs font-semibold text-gray-800 mt-0.5 truncate px-1">
              {board.city || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Asking rate</p>
            <p className="text-xs font-semibold text-gray-800 mt-0.5">
              {formatNaira(board.asking_rate)}
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Campaign selector */}
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">
            Link to campaign <span className="text-red-400">*</span>
          </label>
          {campaigns.length === 0 ? (
            <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
              No active campaigns found. Create a campaign first.
            </div>
          ) : (
            <select
              value={selectedCampaign}
              onChange={e => setSelectedCampaign(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-[#1B4F8A] transition-colors"
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.client_name ? `— ${c.client_name}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Offered rate */}
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">
            Your offer (₦/month) <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">₦</span>
            <input
              type="number"
              value={offeredRate}
              onChange={e => setOfferedRate(Number(e.target.value))}
              className="w-full text-sm border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 focus:outline-none focus:border-[#1B4F8A] transition-colors"
              placeholder="Enter your offer"
            />
          </div>
          {board.asking_rate && offeredRate > 0 && (
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-gray-400">
                Asking: {formatNaira(board.asking_rate)}
              </span>
              {discount > 0 ? (
                <span className="text-xs text-amber-600 font-medium">
                  {discount}% below asking
                </span>
              ) : discount < 0 ? (
                <span className="text-xs text-green-600 font-medium">
                  Above asking rate
                </span>
              ) : (
                <span className="text-xs text-blue-600 font-medium">
                  Asking price
                </span>
              )}
            </div>
          )}
          {/* Rate slider */}
          {board.asking_rate && (
            <input
              type="range"
              min={Math.round(board.asking_rate * 0.5)}
              max={Math.round(board.asking_rate * 1.2)}
              value={offeredRate}
              onChange={e => setOfferedRate(Number(e.target.value))}
              className="w-full mt-2 accent-[#1B4F8A]"
            />
          )}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Start date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2.5 focus:outline-none focus:border-[#1B4F8A] transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              End date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2.5 focus:outline-none focus:border-[#1B4F8A] transition-colors"
            />
          </div>
        </div>

        {/* Duration display */}
        {startDate && endDate && new Date(endDate) > new Date(startDate) && (
          <div className="bg-blue-50 rounded-lg px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-blue-600">Campaign duration</span>
            <span className="text-xs font-semibold text-blue-700">
              {Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))} days
            </span>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">
            Notes to board owner
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Explain your campaign goals, audience, any special requirements..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:border-[#1B4F8A] transition-colors"
          />
        </div>

        {/* Total cost preview */}
        {startDate && endDate && offeredRate > 0 && new Date(endDate) > new Date(startDate) && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">Deal preview</p>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Monthly rate</span>
                <span className="text-xs font-semibold text-gray-800">{formatNaira(offeredRate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Duration</span>
                <span className="text-xs font-semibold text-gray-800">
                  {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30))} month(s)
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-gray-200">
                <span className="text-xs font-semibold text-gray-600">Est. total</span>
                <span className="text-sm font-bold text-gray-900">
                  {formatNaira(
                    offeredRate *
                    Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30))
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="px-4 py-4 border-t border-gray-100 space-y-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || campaigns.length === 0}
          className="w-full bg-[#1B4F8A] hover:bg-[#163f6e] disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
        >
          {submitting ? 'Sending request...' : 'Send booking request'}
        </button>
        <button
          onClick={onClose}
          className="w-full text-gray-500 hover:text-gray-700 text-sm py-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}