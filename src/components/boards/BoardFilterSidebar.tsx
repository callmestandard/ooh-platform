'use client';

type Board = {
  city?: string;
  format?: string;
  status: string;
};

type Filters = {
  status: string;
  format: string;
  city: string;
};

type Props = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  boards: Board[];
};

const FORMATS = [
  { value: 'all', label: 'All Formats' },
  { value: 'billboard', label: 'Billboard' },
  { value: 'unipole', label: 'Unipole' },
  { value: 'gantry', label: 'Gantry' },
  { value: 'bridge_panel', label: 'Bridge Panel' },
  { value: 'wall_drape', label: 'Wall Drape' },
];

const STATUSES = [
  { value: 'all', label: 'All Status' },
  { value: 'available', label: 'Available' },
  { value: 'booked', label: 'Booked' },
  { value: 'maintenance', label: 'Maintenance' },
];

const STATUS_DOTS: Record<string, string> = {
  available: 'bg-green-500',
  booked: 'bg-blue-500',
  maintenance: 'bg-orange-500',
  all: 'bg-gray-300',
};

export default function BoardFilterSidebar({ filters, setFilters, boards }: Props) {
  const cities = ['all', ...Array.from(new Set(boards.map((b) => b.city).filter(Boolean))) as string[]];

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function resetFilters() {
    setFilters({ status: 'all', format: 'all', city: 'all' });
  }

  const hasActiveFilters =
    filters.status !== 'all' || filters.format !== 'all' || filters.city !== 'all';

  return (
    <div className="w-52 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">Filters</span>
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {/* Status */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Status
          </p>
          <div className="space-y-0.5">
            {STATUSES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => updateFilter('status', value)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  filters.status === value
                    ? 'bg-[#1B4F8A]/10 text-[#1B4F8A] font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOTS[value]}`} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Format */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Format
          </p>
          <div className="space-y-0.5">
            {FORMATS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => updateFilter('format', value)}
                className={`w-full px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  filters.format === value
                    ? 'bg-[#1B4F8A]/10 text-[#1B4F8A] font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* City */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            City
          </p>
          <div className="space-y-0.5">
            {cities.map((city) => (
              <button
                key={city}
                onClick={() => updateFilter('city', city)}
                className={`w-full px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  filters.city === city
                    ? 'bg-[#1B4F8A]/10 text-[#1B4F8A] font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {city === 'all' ? 'All Cities' : city}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Legend
        </p>
        <div className="space-y-1.5">
          {[
            { color: 'bg-green-500', label: 'Available' },
            { color: 'bg-blue-500', label: 'Booked' },
            { color: 'bg-orange-500', label: 'Maintenance' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2 text-xs text-gray-500">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}