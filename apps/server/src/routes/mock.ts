import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.ts';

/**
 * Mock 内部系统 API（考勤/订单/员工），供 Agent 工具调用。
 * 数据由 data/mock/*.json 提供，按当前日期相对生成。
 */
export function registerMockRoutes(app: FastifyInstance, services: Services): void {
  app.get('/api/employee/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const emp = services.mockData.employees.find((e) => e.id === id);
    if (!emp) return reply.code(404).send({ error: '员工不存在' });
    return emp;
  });

  app.get('/api/attendance', (req) => {
    const { emp_id, from, to } = req.query as Record<string, string | undefined>;
    let rows = services.mockData.attendance;
    if (emp_id) rows = rows.filter((r) => r.emp_id === emp_id);
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    return { total: rows.length, records: rows };
  });

  app.get('/api/orders', (req) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    let rows = services.mockData.orders;
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    const amount = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    return { total: rows.length, total_amount: amount, records: rows };
  });
}
