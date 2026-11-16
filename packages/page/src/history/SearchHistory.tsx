import { Link, useNavigate } from 'react-router-dom';
import { Clock3, X } from 'lucide-react';
import { clearSearchHistory, removeSearchHistory, searchHistoryId, searchHistoryUrl, useSearchHistory } from './store';

export function SearchHistory({ compact = false }: { compact?: boolean }) {
  const entries = useSearchHistory();
  const navigate = useNavigate();
  if (!entries.length) return null;
  return (
    <section aria-label="搜索历史" className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <Link to="/history" className="flex items-center gap-1 hover:text-foreground"><Clock3 size={14} />搜索历史</Link>
        <button type="button" onClick={clearSearchHistory} className="min-h-8 px-2 hover:text-foreground">清空搜索历史</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.slice(0, compact ? 8 : 30).map(entry => (
          <span key={searchHistoryId(entry)} className="flex max-w-full items-center rounded-full border border-border text-sm">
            <button type="button" title={entry.query} onClick={() => navigate(searchHistoryUrl(entry))}
              className="min-h-9 min-w-0 truncate rounded-l-full py-1 pl-3 pr-1 hover:text-brand-600">{entry.query}</button>
            <button type="button" onClick={() => removeSearchHistory(searchHistoryId(entry))} aria-label={`删除搜索记录 ${entry.query}`} className="flex h-9 w-8 shrink-0 items-center justify-center rounded-r-full text-muted hover:text-danger"><X size={13} /></button>
          </span>
        ))}
      </div>
    </section>
  );
}
