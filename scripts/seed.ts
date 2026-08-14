import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { generateMockData } from '@xiaosu/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

/** 在 Windows 系统字体中找一款中文 TTF 字体（PDF 中文渲染必需；.ttc 集合 PDFKit 不支持子集化）。 */
function findCjkFont(): string | null {
  const candidates = [
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/Deng.ttf',
    'C:/Windows/Fonts/simkai.ttf',
    'C:/Windows/Fonts/simsunb.ttf',
  ];
  return candidates.find((f) => existsSync(f)) ?? null;
}

const TXT_CONTENT = `假期政策（苏云科技）

一、年假
入职满 1 年的员工每年享有 5 天带薪年假；工龄每满 1 年增加 1 天，上限 15 天。
年假以自然年计算，当年未休完的部分（最多 5 天）可顺延至次年 3 月 31 日。

二、病假
每月 1 天带薪病假无需证明；超过 1 天须提供二级以上医院证明，病假工资按基本工资的 80% 发放。

三、事假
按日扣减工资，连续事假超过 3 天须部门负责人与 HRBP 双重审批。

四、调休
加班产生的调休须在 3 个月内使用完毕，逾期作废。
`;

const DOCX_PARAGRAPHS = [
  '考勤管理制度（苏云科技）',
  '第一条 标准工时为周一至周五 9:00–18:00，午休 12:00–13:30。',
  '第二条 每天 9:00–10:00 打卡为弹性时间，10:00 之后打卡视为迟到。',
  '第三条 迟到 30 分钟以内每次扣 20 元；超过 30 分钟按旷工半天处理。',
  '第四条 忘记打卡每月可补卡 2 次，通过 OA 提交补卡申请。',
  '第五条 工作日 19:30 之后离岗计算加班，按 1.5 倍时薪折算加班费或调休。',
  '第六条 周末加班按 2 倍时薪折算加班费或调休，需提前 1 天在 OA 报备。',
];

const PDF_LINES = [
  '费用报销细则（苏云科技）',
  '',
  '一、发票要求',
  '增值税发票原件（电子发票打印件亦可），抬头为"苏云科技有限公司"。',
  '',
  '二、材料清单',
  '1. 发票原件；2. 《费用报销单》；3. 超过 500 元附审批截图。',
  '',
  '三、差旅报销',
  '另附行程单（机票/火车票）与住宿水单。',
  '',
  '四、时效与打款',
  '费用发生后 90 天内提交报销，逾期不予受理；次月 10 日统一打款。',
  '',
  '五、住宿标准',
  '一线城市 500 元/晚，其他城市 350 元/晚，超支部分自理。',
];

async function generateFormatFiles(): Promise<void> {
  mkdirSync(join(DATA, 'seed'), { recursive: true });

  // TXT
  writeFileSync(join(DATA, 'seed', '假期政策.txt'), TXT_CONTENT, 'utf-8');
  console.log('✓ data/seed/假期政策.txt');

  // DOCX
  const docx = new Document({
    sections: [
      {
        children: DOCX_PARAGRAPHS.map(
          (text, i) =>
            new Paragraph({
              heading: i === 0 ? undefined : undefined,
              children: [new TextRun({ text, bold: i === 0, size: i === 0 ? 32 : 24 })],
            }),
        ),
      },
    ],
  });
  writeFileSync(join(DATA, 'seed', '考勤制度.docx'), await Packer.toBuffer(docx));
  console.log('✓ data/seed/考勤制度.docx');

  // PDF（需要中文字体）
  const font = findCjkFont();
  if (!font) throw new Error('未找到中文字体（C:/Windows/Fonts/msyh.ttc 等），无法生成测试 PDF');
  const pdfPath = join(DATA, 'seed', '报销细则.pdf');
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 } });
  const stream = createWriteStream(pdfPath);
  pdf.pipe(stream);
  pdf.font(font);
  pdf.fontSize(18).text(PDF_LINES[0]!, { align: 'center' });
  pdf.moveDown();
  pdf.fontSize(11);
  for (const line of PDF_LINES.slice(1)) {
    if (!line) {
      pdf.moveDown(0.5);
      continue;
    }
    if (/^[一二三四五]/.test(line)) {
      pdf.moveDown(0.5).fontSize(13).text(line);
      pdf.fontSize(11);
    } else {
      pdf.text(line);
    }
  }
  pdf.end();
  await new Promise<void>((res, rej) => {
    stream.on('finish', () => res());
    stream.on('error', rej);
  });
  console.log(`✓ data/seed/报销细则.pdf（字体: ${font.split('/').pop()}）`);
}

function generateMockFiles(): void {
  mkdirSync(join(DATA, 'mock'), { recursive: true });
  const mock = generateMockData();
  writeFileSync(join(DATA, 'mock', 'employees.json'), JSON.stringify(mock.employees, null, 2));
  writeFileSync(join(DATA, 'mock', 'attendance.json'), JSON.stringify(mock.attendance, null, 2));
  writeFileSync(join(DATA, 'mock', 'orders.json'), JSON.stringify(mock.orders, null, 2));
  console.log(
    `✓ data/mock/*.json（员工 ${mock.employees.length} · 考勤 ${mock.attendance.length} 条 · 订单 ${mock.orders.length} 条）`,
  );
}

async function main(): Promise<void> {
  console.log('[seed] 生成 mock 接口数据（按当前日期相对生成）...');
  generateMockFiles();
  console.log('[seed] 生成 PDF/DOCX/TXT 测试文档...');
  await generateFormatFiles();
  console.log('[seed] 完成。');
}

main().catch((e) => {
  console.error('[seed] 失败:', e);
  process.exit(1);
});
