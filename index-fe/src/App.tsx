import { useState, useEffect, useMemo } from 'react';
import { fetchPrices } from './api/client';
import type { GpuPrice } from './types';

type SortKey = 'canonical_name' | 'provider' | 'instance_type' | 'price_per_hour' | 'memory_gb' | 'all_time_low' | 'all_time_high';
type SortDir = 'asc' | 'desc';

function App() {
  const [prices, setPrices] = useState<GpuPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState<'all' | 'runpod' | 'vast' | 'runcrate'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('canonical_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPrices(await fetchPrices());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const rows = useMemo(() => {
    let filtered = prices;
    if (providerFilter !== 'all') {
      filtered = filtered.filter(p => p.provider === providerFilter);
    }
    if (filter) {
      const q = filter.toLowerCase();
      filtered = filtered.filter(p =>
        (p.canonical_name ?? '').toLowerCase().includes(q) ||
        (p.display_name ?? '').toLowerCase().includes(q) ||
        p.gpu_id.toLowerCase().includes(q)
      );
    }
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) cmp = 0;
      else if (av == null) cmp = 1;
      else if (bv == null) cmp = -1;
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [prices, filter, providerFilter, sortKey, sortDir]);

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const lastUpdated = prices.length > 0
    ? new Date(Math.max(...prices.map(p => new Date(p.fetched_at).getTime()))).toLocaleString()
    : null;
  const modelCount = new Set(prices.map(p => p.canonical_name)).size;
  const providerCounts = {
    runpod: prices.filter(p => p.provider === 'runpod').length,
    vast: prices.filter(p => p.provider === 'vast').length,
    runcrate: prices.filter(p => p.provider === 'runcrate').length,
  };
  const cheapest = prices.length > 0
    ? prices.reduce((best, price) => price.price_per_hour < best.price_per_hour ? price : best)
    : null;
  const observationCount = prices.reduce((total, price) => total + price.observation_count, 0);

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-black px-6 py-5">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">GPU Price Index</h1>
            <p className="text-sm text-neutral-500 mt-1">
              {prices.length} current prices across {modelCount} verified models
              {lastUpdated && <> · Last updated {lastUpdated}</>}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="self-start border border-black px-4 py-2 text-sm font-medium hover:bg-black hover:text-white transition-colors disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {error ? (
          <div className="border border-black p-6">
            <p className="font-semibold">Error: {error}</p>
            <p className="text-sm text-neutral-500 mt-1">Make sure the backend is running on port 8000.</p>
            <button onClick={load} className="mt-3 border border-black px-3 py-1 text-sm hover:bg-black hover:text-white transition-colors">
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="border border-black px-6 py-16 text-center">
            <p className="font-semibold">Loading GPU prices…</p>
            <p className="mt-1 text-sm text-neutral-500">Reading the latest provider snapshots and historical ranges.</p>
          </div>
        ) : (
          <>
            <section className="mb-6 grid grid-cols-2 border-l border-t border-black lg:grid-cols-4">
              <Stat label="Verified models" value={String(modelCount)} />
              <Stat label="Current listings" value={String(prices.length)} detail={`${providerCounts.runpod} RunPod · ${providerCounts.vast} Vast.ai · ${providerCounts.runcrate} Runcrate`} />
              <Stat label="Lowest current" value={cheapest ? formatPrice(cheapest.price_per_hour, cheapest.currency) : '—'} detail={cheapest ? `${cheapest.canonical_name} · ${formatProvider(cheapest.provider)}` : undefined} />
              <Stat label="Historical observations" value={observationCount.toLocaleString()} />
            </section>

            {/* Filters */}
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <input
                type="text"
                placeholder="Search GPU model…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="border border-black px-3 py-2 text-sm w-full sm:w-64 outline-none focus:ring-1 focus:ring-black"
              />
              <div className="flex gap-1 border border-black">
                {(['all', 'runpod', 'vast', 'runcrate'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setProviderFilter(v)}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${providerFilter === v ? 'bg-black text-white' : 'hover:bg-neutral-100'}`}
                  >
                    {v === 'all' ? `All ${prices.length}` : v === 'runpod' ? `RunPod ${providerCounts.runpod}` : v === 'vast' ? `Vast.ai ${providerCounts.vast}` : `Runcrate ${providerCounts.runcrate}`}
                  </button>
                ))}
              </div>
              <span className="text-sm text-neutral-500">{rows.length} results</span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto border border-black">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-black bg-neutral-50">
                    <Th onClick={() => toggleSort('canonical_name')}>GPU{arrow('canonical_name')}</Th>
                    <Th onClick={() => toggleSort('provider')}>Provider{arrow('provider')}</Th>
                    <Th onClick={() => toggleSort('memory_gb')}>VRAM{arrow('memory_gb')}</Th>
                    <Th onClick={() => toggleSort('instance_type')}>Price type{arrow('instance_type')}</Th>
                    <Th onClick={() => toggleSort('price_per_hour')}>Current{arrow('price_per_hour')}</Th>
                    <Th onClick={() => toggleSort('all_time_low')}>All-time low{arrow('all_time_low')}</Th>
                    <Th onClick={() => toggleSort('all_time_high')}>All-time high{arrow('all_time_high')}</Th>
                    <Th>Availability</Th>
                    <Th>History</Th>
                    <Th>Updated</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={`${p.provider}-${p.gpu_id}-${p.instance_type}-${p.fetched_at}`} className="border-b border-neutral-200 align-top hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{p.canonical_name}</p>
                        <p className="mt-0.5 max-w-52 truncate text-xs text-neutral-500" title={`${p.display_name ?? p.gpu_id} · ${p.gpu_id}`}>
                          {p.display_name ?? p.gpu_id}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-medium">{formatProvider(p.provider)}</td>
                      <td className="px-4 py-3">{p.memory_gb != null ? `${Math.round(p.memory_gb)} GB` : '—'}</td>
                      <td className="px-4 py-3">{formatPriceType(p.instance_type)}</td>
                      <td className="px-4 py-3 font-mono font-bold">{formatPrice(p.price_per_hour, p.currency)}</td>
                      <td className="px-4 py-3 font-mono">{formatPrice(p.all_time_low, p.currency)}</td>
                      <td className="px-4 py-3 font-mono">{formatPrice(p.all_time_high, p.currency)}</td>
                      <td className="px-4 py-3 text-xs">{formatAvailability(p)}</td>
                      <td className="px-4 py-3 text-xs">
                        <p>{p.observation_count.toLocaleString()} observations</p>
                        <p className="mt-0.5 text-neutral-500">Since {formatDate(p.first_seen_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{formatDateTime(p.fetched_at)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-neutral-400">No matching prices.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-black px-6 py-4 mt-12">
        <p className="text-center text-xs text-neutral-400">
          GPU Price Index · Data fetched hourly from RunPod, Vast.ai &amp; Runcrate · Prices in USD
        </p>
      </footer>
    </div>
  );
}

function formatProvider(provider: string) {
  return provider === 'runpod' ? 'RunPod' : provider === 'vast' ? 'Vast.ai' : provider === 'runcrate' ? 'Runcrate' : provider;
}

function formatPriceType(type: string) {
  const labels: Record<string, string> = {
    secure: 'Secure cloud',
    community: 'Community cloud',
    secure_spot: 'Secure spot',
    community_spot: 'Community spot',
    ondemand: 'On-demand',
    bid: 'Bid / interruptible',
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(price);
}

function formatAvailability(price: GpuPrice) {
  if (!price.stock_status) return 'Not reported';
  if (price.provider === 'vast' && /^\d+$/.test(price.stock_status)) {
    return `${Number(price.stock_status).toLocaleString()} verified offers`;
  }
  return price.stock_status.replaceAll('_', ' ');
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], { dateStyle: 'medium' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="border-b border-r border-black p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-xs text-neutral-500">{detail}</p>}
    </div>
  );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">
      {onClick ? (
        <button type="button" onClick={onClick} className="whitespace-nowrap hover:underline focus:outline-none focus-visible:underline">
          {children}
        </button>
      ) : children}
    </th>
  );
}

export default App;
