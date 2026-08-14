import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mock 内部系统数据：按「当前日期」相对生成，保证任何时候演示都有"上周"数据
// ---------------------------------------------------------------------------

export interface Employee {
  id: string;
  name: string;
  dept: string;
  level: string;
  title: string;
  hire_date: string;
}

export interface AttendanceRecord {
  emp_id: string;
  date: string; // YYYY-MM-DD
  check_in: string | null; // HH:mm，null 表示缺卡/请假
  check_out: string | null;
  status: 'normal' | 'late' | 'early_leave' | 'overtime' | 'missing' | 'leave' | 'sick';
}

export interface Order {
  id: string;
  amount: number;
  date: string;
  customer: string;
  product: string;
  status: 'paid' | 'refunded' | 'pending';
}

export interface MockData {
  employees: Employee[];
  attendance: AttendanceRecord[];
  orders: Order[];
}

/** mulberry32：固定种子可复现伪随机。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStr(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const EMPLOYEE_RAW: Array<[string, string, string, string, string]> = [
  ['001', '张三', '研发部', 'P5', '高级后端工程师'],
  ['002', '李四', '研发部', 'P6', '资深前端工程师'],
  ['003', '王五', '产品部', 'P5', '产品经理'],
  ['004', '赵六', '设计部', 'P4', '视觉设计师'],
  ['005', '钱七', '市场部', 'P5', '市场专员'],
  ['006', '孙八', '销售部', 'P4', '销售顾问'],
  ['007', '周九', '人事部', 'P5', 'HRBP'],
  ['008', '吴十', '财务部', 'P5', '财务专员'],
  ['009', '郑十一', '研发部', 'P7', '技术专家'],
  ['010', '冯十二', '测试部', 'P5', '测试工程师'],
  ['011', '陈十三', '产品部', 'P6', '高级产品经理'],
  ['012', '褚十四', '设计部', 'P5', '交互设计师'],
  ['013', '卫十五', '销售部', 'P5', '大客户经理'],
  ['014', '蒋十六', '市场部', 'P4', '品牌专员'],
  ['015', '沈十七', '研发部', 'P4', '后端工程师'],
];

const CUSTOMERS = ['A 公司', 'B 集团', 'C 科技', 'D 贸易', 'E 制造', 'F 零售', 'G 物流', 'H 教育'];
const PRODUCTS = ['苏办·专业版', '苏办·企业版', '苏办·旗舰版', '数据驾驶舱模块', 'AI 助手模块'];

/** 生成（或加载）mock 数据；种子固定，同一自然日结果一致。 */
export function generateMockData(now: Date = new Date()): MockData {
  const seed = now.getFullYear() * 1000 + (now.getMonth() + 1) * 31 + now.getDate();
  const rng = mulberry32(seed);

  // 员工：入职日期相对今天往回推
  const employees: Employee[] = EMPLOYEE_RAW.map(([id, name, dept, level, title], i) => {
    const yearsAgo = 1 + Math.floor(rng() * 7);
    const hire = addDays(now, -365 * yearsAgo - Math.floor(rng() * 200));
    return { id, name, dept, level, title, hire_date: fmtDate(hire) };
  });

  // 考勤：最近 21 个自然日里的工作日
  const attendance: AttendanceRecord[] = [];
  for (let day = 21; day >= 1; day--) {
    const d = addDays(now, -day);
    if (isWeekend(d)) continue;
    const date = fmtDate(d);
    for (const emp of employees) {
      const r = rng();
      if (r < 0.015) {
        attendance.push({ emp_id: emp.id, date, check_in: null, check_out: null, status: 'sick' });
      } else if (r < 0.03) {
        attendance.push({ emp_id: emp.id, date, check_in: null, check_out: null, status: 'leave' });
      } else if (r < 0.05) {
        attendance.push({ emp_id: emp.id, date, check_in: null, check_out: null, status: 'missing' });
      } else if (r < 0.09) {
        // 迟到
        const ci = timeStr(10, 5 + Math.floor(rng() * 35));
        const co = timeStr(18, Math.floor(rng() * 40));
        attendance.push({ emp_id: emp.id, date, check_in: ci, check_out: co, status: 'late' });
      } else if (r < 0.3) {
        // 加班
        const ci = timeStr(8, 40 + Math.floor(rng() * 50));
        const co = timeStr(19, 35 + Math.floor(rng() * 115));
        attendance.push({ emp_id: emp.id, date, check_in: ci, check_out: co, status: 'overtime' });
      } else if (r < 0.32) {
        // 早退
        const ci = timeStr(8, 40 + Math.floor(rng() * 50));
        const co = timeStr(17, Math.floor(rng() * 40));
        attendance.push({ emp_id: emp.id, date, check_in: ci, check_out: co, status: 'early_leave' });
      } else {
        const ci = timeStr(8, 40 + Math.floor(rng() * 55));
        const co = timeStr(18, Math.floor(rng() * 60));
        attendance.push({ emp_id: emp.id, date, check_in: ci, check_out: co, status: 'normal' });
      }
    }
  }

  // 订单：最近 42 天
  const orders: Order[] = [];
  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor(rng() * 42);
    const d = addDays(now, -daysAgo);
    const r = rng();
    const status: Order['status'] = r < 0.08 ? 'refunded' : r < 0.12 ? 'pending' : 'paid';
    const id = `O${fmtDate(d).replaceAll('-', '')}${String(i + 1).padStart(3, '0')}`;
    orders.push({
      id,
      amount: Math.round((50 + rng() * 7950) * 100) / 100,
      date: fmtDate(d),
      customer: CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)]!,
      product: PRODUCTS[Math.floor(rng() * PRODUCTS.length)]!,
      status,
    });
  }
  orders.sort((a, b) => (a.date < b.date ? -1 : 1));

  return { employees, attendance, orders };
}

/** 从目录加载 mock JSON；不存在则生成并落盘。 */
export function loadMockData(dir: string, now: Date = new Date()): MockData {
  mkdirSync(dir, { recursive: true });
  const files = ['employees.json', 'attendance.json', 'orders.json'] as const;
  const missing = files.some((f) => !existsSync(join(dir, f)));
  if (!missing) {
    return {
      employees: JSON.parse(readFileSync(join(dir, 'employees.json'), 'utf-8')),
      attendance: JSON.parse(readFileSync(join(dir, 'attendance.json'), 'utf-8')),
      orders: JSON.parse(readFileSync(join(dir, 'orders.json'), 'utf-8')),
    };
  }
  const data = generateMockData(now);
  writeFileSync(join(dir, 'employees.json'), JSON.stringify(data.employees, null, 2));
  writeFileSync(join(dir, 'attendance.json'), JSON.stringify(data.attendance, null, 2));
  writeFileSync(join(dir, 'orders.json'), JSON.stringify(data.orders, null, 2));
  return data;
}
