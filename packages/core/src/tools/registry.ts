import type { MockData } from './mockdata.ts';
import {
  executeAttendance,
  executeCalculator,
  executeCurrentTime,
  executeEmployeeInfo,
  executeOrders,
} from './executors.ts';
import type { ToolExecResult, ToolRegistry } from './types.ts';
import type { ToolDefinition } from '../types.ts';

const DEFS: ToolDefinition[] = [
  {
    name: 'employee_info',
    description: '按员工编号查询员工基本信息（部门、职级、职位、入职日期）',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '员工编号，3 位数字，如 001' } },
      required: ['id'],
    },
  },
  {
    name: 'attendance_query',
    description: '查询考勤记录（可指定员工与日期范围，日期格式 YYYY-MM-DD）',
    parameters: {
      type: 'object',
      properties: {
        emp_id: { type: 'string', description: '员工编号，可选' },
        from: { type: 'string', description: '起始日期 YYYY-MM-DD，可选' },
        to: { type: 'string', description: '结束日期 YYYY-MM-DD，可选' },
      },
    },
  },
  {
    name: 'orders_query',
    description: '查询订单记录（可指定日期范围），返回汇总与明细',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起始日期 YYYY-MM-DD，可选' },
        to: { type: 'string', description: '结束日期 YYYY-MM-DD，可选' },
      },
    },
  },
  {
    name: 'current_time',
    description: '获取当前日期时间与星期（计算"上周""今天"等相对时间前先调用）',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'calculator',
    description: '计算数学表达式，支持 + - * / ( ) %',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: '如 (1280+350)/2' } },
      required: ['expression'],
    },
  },
];

/** 构建工具注册表：模型可自主选择调用哪些工具。 */
export function buildToolRegistry(data: MockData, now: () => Date = () => new Date()): ToolRegistry {
  return {
    defs: DEFS,
    async execute(name: string, args: unknown): Promise<ToolExecResult> {
      switch (name) {
        case 'employee_info':
          return executeEmployeeInfo(data, args);
        case 'attendance_query':
          return executeAttendance(data, args, now());
        case 'orders_query':
          return executeOrders(data, args);
        case 'current_time':
          return executeCurrentTime(now());
        case 'calculator':
          return executeCalculator(args);
        default:
          return { ok: false, error: `未知工具: ${name}` };
      }
    },
  };
}
