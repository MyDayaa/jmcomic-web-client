import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Trash2 } from 'lucide-react';
import { SearchHistory } from './SearchHistory';
import { clearReadingHistory, importReadingProgress, removeReadingHistory, useReadingHistory } from './store';

export default function HistoryPage() {
  const entries = useReadingHistory();
  useEffect(importReadingProgress, []);
  return (
    <main className="fixed inset-0 overflow-y-auto bg-background px-4 py-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-3xl space-y-6 pb-8">
        <header className="flex items-center gap-3">
          <Link to="/" aria-label="返回首页" className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"><ArrowLeft size={18} /></Link>
          <div><h1 className="text-lg font-semibold">历史记录</h1><p className="text-xs text-muted">保存在当前浏览器，无需登录</p></div>
        </header>
        <SearchHistory />
        <section aria-label="本地阅读历史" className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-medium">阅读历史</h2>{entries.length > 0 && <button type="button" onClick={clearReadingHistory} className="min-h-9 px-2 text-xs text-muted">清空阅读历史</button>}</div>
          {entries.length === 0 ? <p className="py-8 text-center text-sm text-muted">暂无阅读记录，打开作品阅读后会自动保存。</p> : (
            <ul className="space-y-2">
              {entries.map(entry => (
                <li key={entry.albumId} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                  <BookOpen size={20} className="shrink-0 text-brand-500" />
                  <Link to={`/reader/${entry.chapterId}`} className="min-w-0 flex-1 space-y-1" state={{ resumePage: entry.page, historyAlbumId: entry.albumId }}>
                    <div className="truncate text-sm font-medium">{entry.title}</div>
                    {entry.chapterName && <div className="truncate text-xs text-muted">{entry.chapterName}</div>}
                    <div className="text-xs text-muted">第 {entry.page + 1} / {entry.totalPages} 页 · {new Date(entry.updatedAt).toLocaleString()}</div>
                    <span className="text-xs text-brand-600 dark:text-brand-300">继续阅读</span>
                  </Link>
                  <button type="button" onClick={() => removeReadingHistory(entry.albumId)} aria-label={`删除阅读记录 ${entry.title}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:text-danger"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
