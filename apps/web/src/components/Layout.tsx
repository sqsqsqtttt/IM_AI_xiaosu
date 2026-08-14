import { NavLink, Outlet } from 'react-router';
import { Bot, FileText, MessageSquare, ScrollText, Settings2 } from 'lucide-react';

const NAV = [
  { to: '/documents', label: '文档库', icon: FileText },
  { to: '/logs', label: '对话日志', icon: ScrollText },
  { to: '/chat', label: '聊天测试', icon: MessageSquare },
  { to: '/settings', label: '设置', icon: Settings2 },
];

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-slate-900 text-slate-200 flex flex-col">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-800">
          <Bot className="w-6 h-6 text-blue-400" />
          <div>
            <div className="font-bold text-white">小苏</div>
            <div className="text-[11px] text-slate-400">内部 AI 助手 · 管理后台</div>
          </div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-5 py-2.5 text-sm transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] text-slate-500 border-t border-slate-800">
          苏云科技 · 内部工具
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
