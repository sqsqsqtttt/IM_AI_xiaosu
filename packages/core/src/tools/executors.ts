import { z } from 'zod';
import type { MockData } from './mockdata.ts';
import type { ToolExecResult } from './types.ts';

// ---------------------------------------------------------------------------
// 各工具的 zod 参数校验 + 执行逻辑
// ---------------------------------------------------------------------------

const EmployeeQuerySchema = z
  .object({
    id: z.string().regex(/^\d{3}$/, '员工编号为 3 位数字，如 001').optional(),
    name: z.string().min(1).max(20).optional(),
  })
  .refine((v) => v.id !== undefined || v.name !== undefined, {
    message: '至少提供员工编号 id 或姓名 name',
  });

const DateRangeSchema = z.object({
  emp_id: z.string().regex(/^\d{3}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const CalcSchema = z.object({ expression: z.string().min(1).max(200) });

/** 员工查询：支持按编号或姓名（姓名支持精确/模糊匹配）。 */
export function executeEmployeeInfo(data: MockData, args: unknown): ToolExecResult {
  const parsed = EmployeeQuerySchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: `参数错误: ${parsed.error.issues[0]?.message ?? '无效参数'}` };
  const { id, name } = parsed.data;
  if (id) {
    const emp = data.employees.find((e) => e.id === id);
    if (!emp) return { ok: false, error: `未找到员工编号 ${id}` };
    return { ok: true, data: emp };
  }
  const exact = data.employees.filter((e) => e.name === name);
  if (exact.length === 1) return { ok: true, data: exact[0] };
  if (exact.length > 1) return { ok: true, data: { candidates: exact } };
  const fuzzy = data.employees.filter((e) => e.name.includes(name!));
  if (fuzzy.length === 0) return { ok: false, error: `未找到名为「${name}」的员工` };
  return { ok: true, data: { candidates: fuzzy } };
}

export function executeAttendance(data: MockData, args: unknown, now: Date): ToolExecResult {
  const parsed = DateRangeSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: `参数错误: ${parsed.error.issues[0]?.message ?? '无效参数'}` };
  const { emp_id, from, to } = parsed.data;
  let rows = data.attendance;
  if (emp_id) rows = rows.filter((r) => r.emp_id === emp_id);
  if (from) rows = rows.filter((r) => r.date >= from);
  if (to) rows = rows.filter((r) => r.date <= to);
  if (!from && !to) {
    // 默认最近 7 天
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    const cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows = rows.filter((r) => r.date >= cutoff);
  }
  rows = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.emp_id < b.emp_id ? -1 : 1));
  const summary = {
    total_days: rows.length,
    normal: rows.filter((r) => r.status === 'normal').length,
    late: rows.filter((r) => r.status === 'late').length,
    overtime: rows.filter((r) => r.status === 'overtime').length,
    early_leave: rows.filter((r) => r.status === 'early_leave').length,
    missing: rows.filter((r) => r.status === 'missing').length,
    leave: rows.filter((r) => r.status === 'leave').length,
    sick: rows.filter((r) => r.status === 'sick').length,
  };
  return { ok: true, data: { summary, records: rows } };
}

export function executeOrders(data: MockData, args: unknown): ToolExecResult {
  const parsed = DateRangeSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: `参数错误: ${parsed.error.issues[0]?.message ?? '无效参数'}` };
  const { from, to } = parsed.data;
  let rows = data.orders;
  if (from) rows = rows.filter((r) => r.date >= from);
  if (to) rows = rows.filter((r) => r.date <= to);
  const summary = {
    total: rows.length,
    total_amount: Math.round(rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0) * 100) / 100,
    refunded: rows.filter((r) => r.status === 'refunded').length,
    pending: rows.filter((r) => r.status === 'pending').length,
  };
  return { ok: true, data: { summary, records: rows } };
}

export function executeCurrentTime(now: Date): ToolExecResult {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const iso = now.toISOString();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    ok: true,
    data: {
      iso,
      local,
      weekday: `周${weekdays[now.getDay()]}`,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    },
  };
}

/** 计算器：白名单字符的安全表达式求值（仅数字与四则运算）。 */
export function executeCalculator(args: unknown): ToolExecResult {
  const parsed = CalcSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: '参数错误: 需要 expression 字段' };
  const expr = parsed.data.expression;
  if (!/^[\d+\-*/().%\s]+$/.test(expr)) {
    return { ok: false, error: '表达式只允许数字与 + - * / ( ) % 运算符' };
  }
  try {
    // 白名单正则已排除字母与下划线，Function 构造器安全
    const fn = new Function(`"use strict"; return (${expr});`) as () => number;
    const result = fn();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { ok: false, error: '表达式结果无效' };
    }
    return { ok: true, data: { expression: expr, result: Math.round(result * 1e10) / 1e10 } };
  } catch {
    return { ok: false, error: '表达式无法计算' };
  }
}
