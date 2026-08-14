/** pino-roll 无类型声明（其 API 仅一个工厂函数，签名见官方 README）。 */
declare module 'pino-roll' {
  import type { Transform } from 'node:stream';

  interface PinoRollOptions {
    file?: string;
    size?: string | number;
    frequency?: 'daily' | 'hourly' | false;
    dateFormat?: string;
    mkdir?: boolean;
    extension?: string;
  }

  export default function pinoRoll(options?: PinoRollOptions): Transform;
}
