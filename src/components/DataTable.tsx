import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

interface Props<T extends { id: string }> {
  data: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  searchKeys?: (keyof T)[];
  actions?: (row: T) => React.ReactNode;
  pageSize?: number;
  rowId?: (row: T) => string;
  highlightId?: string;
}

export default function DataTable<T extends { id: string }>({
  data, columns, onRowClick, searchKeys = [], actions, pageSize = 20,
  rowId, highlightId,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return data;
    const q = query.toLowerCase();
    return data.filter(row =>
      searchKeys.some(k => String((row as any)[k] ?? '').toLowerCase().includes(q))
    );
  }, [data, query, searchKeys]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = String((a as any)[sortKey] ?? '');
      const bv = String((b as any)[sortKey] ?? '');
      return sortDir === 'asc' ? av.localeCompare(bv, 'he') : bv.localeCompare(av, 'he');
    });
  }, [filtered, sortKey, sortDir]);

  const pages = Math.ceil(sorted.length / pageSize);
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  };

  const handleSearch = (v: string) => { setQuery(v); setPage(0); };

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative w-72">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="חיפוש..."
          className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
        />
      </div>

      {/* Count */}
      <div className="text-xs text-slate-400">{filtered.length} רשומות</div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  className={`text-right px-4 py-3 font-semibold text-slate-600 whitespace-nowrap ${col.width ?? ''} ${col.sortable ? 'cursor-pointer select-none hover:bg-slate-100' : ''}`}
                  onClick={() => col.sortable && toggleSort(String(col.key))}
                >
                  <span className="flex items-center gap-1 justify-start">
                    {col.header}
                    {col.sortable && (
                      sortKey === String(col.key)
                        ? sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                        : <ChevronsUpDown size={13} className="text-slate-300" />
                    )}
                  </span>
                </th>
              ))}
              {actions && <th className="text-right px-4 py-3 font-semibold text-slate-600 w-24">פעולות</th>}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 && (
              <tr><td colSpan={columns.length + (actions ? 1 : 0)} className="text-center py-12 text-slate-400">אין תוצאות</td></tr>
            )}
            {pageData.map(row => (
              <tr
                key={row.id}
                id={rowId ? rowId(row) : undefined}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-slate-100 last:border-0 transition-colors ${onRowClick ? 'cursor-pointer hover:bg-blue-50/50' : 'hover:bg-slate-50/50'} ${highlightId === row.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
              >
                {columns.map(col => (
                  <td key={String(col.key)} className="px-4 py-3 text-slate-700">
                    {col.render ? col.render(row) : String((row as any)[col.key] ?? '—')}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center gap-2 justify-center text-sm">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-100">
            הקודם
          </button>
          <span className="text-slate-500">{page + 1} / {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-100">
            הבא
          </button>
        </div>
      )}
    </div>
  );
}
