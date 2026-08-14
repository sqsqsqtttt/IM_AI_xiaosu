const STYLES: Record<string, string> = {
  indexed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  connected: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  disconnected: 'bg-rose-50 text-rose-700 border-rose-200',
  disabled: 'bg-slate-100 text-slate-500 border-slate-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
};

const LABELS: Record<string, string> = {
  indexed: '已索引',
  pending: '索引中',
  failed: '失败',
  connected: '已连接',
  disconnected: '未连接',
  disabled: '已停用',
  ok: '正常',
  error: '错误',
};

export default function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">-</span>;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        STYLES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
