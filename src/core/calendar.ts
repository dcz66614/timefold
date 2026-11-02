import { TimeFoldError } from './types';

/**
 * P009 时隙镜 TimeFold — 严格公历与 UTC 分钟模块
 *
 * 严格遵循 PROJECT_BOOK.md §5.1 与 IMPLEMENTATION_PLAN.md §2.3。
 * 绝不依赖 OS 本地时区；只用 Date.UTC / Date.prototype.getUTC* / 纯公历算术。
 */

/**
 * 判断公历闰年（4年一闰，百年不闰，400年又闰）
 */
export function isLeapYear(year: number): boolean {
  if (!Number.isInteger(year)) {
    return false;
  }
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * 获取指定公历年份与月份的天数（month: 1..12）
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
      return 31;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 3:
      return 31;
    case 4:
      return 30;
    case 5:
      return 31;
    case 6:
      return 30;
    case 7:
      return 31;
    case 8:
      return 31;
    case 9:
      return 30;
    case 10:
      return 31;
    case 11:
      return 30;
    case 12:
      return 31;
    default:
      return 0;
  }
}

/**
 * 校验公历日期数值合法性（year: 0..9999, month: 1..12, day: 1..maxDay）
 */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 0 || year > 9999) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const maxDay = getDaysInMonth(year, month);
  return day >= 1 && day <= maxDay;
}

/**
 * 校验时间数值合法性（hour: 0..23, minute: 0..59）
 */
export function isValidTime(hour: number, minute: number): boolean {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return false;
  }
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_REGEX = /^(\d{2}):(\d{2})$/;
const LOCAL_DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const UTC_ISO_STRICT_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * 严格解析 YYYY-MM-DD
 */
export function parseDate(
  dateStr: string,
  path: string = 'date'
): { year: number; month: number; day: number } {
  if (typeof dateStr !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_DATE_FORMAT',
      path,
      message: `Expected date string, got ${typeof dateStr}`,
    });
  }
  const match = DATE_REGEX.exec(dateStr);
  if (!match || !match[1] || !match[2] || !match[3]) {
    throw new TimeFoldError({
      code: 'E_INVALID_DATE_FORMAT',
      path,
      message: `Invalid date format: expected YYYY-MM-DD, got "${dateStr}"`,
    });
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (!isValidDate(year, month, day)) {
    throw new TimeFoldError({
      code: 'E_INVALID_DATE',
      path,
      message: `Invalid calendar date: "${dateStr}"`,
    });
  }
  return { year, month, day };
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(year: number, month: number, day: number): string {
  if (!isValidDate(year, month, day)) {
    throw new TimeFoldError({
      code: 'E_INVALID_DATE',
      path: 'date',
      message: `Cannot format invalid calendar date: ${year}-${month}-${day}`,
    });
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 判断字符串是否为严格合法的 YYYY-MM-DD 日期
 */
export function isValidDateString(dateStr: string): boolean {
  try {
    parseDate(dateStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * 严格解析 HH:mm
 */
export function parseTime(
  timeStr: string,
  path: string = 'time'
): { hour: number; minute: number } {
  if (typeof timeStr !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_TIME_FORMAT',
      path,
      message: `Expected time string, got ${typeof timeStr}`,
    });
  }
  const match = TIME_REGEX.exec(timeStr);
  if (!match || !match[1] || !match[2]) {
    throw new TimeFoldError({
      code: 'E_INVALID_TIME_FORMAT',
      path,
      message: `Invalid time format: expected HH:mm, got "${timeStr}"`,
    });
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);

  if (!isValidTime(hour, minute)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TIME',
      path,
      message: `Invalid time: "${timeStr}"`,
    });
  }
  return { hour, minute };
}

/**
 * 格式化时间为 HH:mm
 */
export function formatTime(hour: number, minute: number): string {
  if (!isValidTime(hour, minute)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TIME',
      path: 'time',
      message: `Cannot format invalid time: ${hour}:${minute}`,
    });
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * 判断字符串是否为严格合法的 HH:mm
 */
export function isValidTimeString(timeStr: string): boolean {
  try {
    parseTime(timeStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全使用 Date.UTC 编码公历时刻到绝对 UTC 毫秒数。
 * 避开 JS Date.UTC(0..99) 视为 1900+year 的怪异特性。
 */
function toUtcMilliseconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number = 0
): number {
  if (year >= 100) {
    return Date.UTC(year, month - 1, day, hour, minute, second);
  }
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day);
  dt.setUTCHours(hour, minute, second, 0);
  return dt.getTime();
}

/**
 * 严格解析 UTC ISO 字符串为 UTC 分钟整数。
 * 必须匹配 YYYY-MM-DDTHH:mm:00Z，秒位严格为 00，拒绝非法公历日期、拒绝非整分钟。
 */
export function parseUtcMinute(iso: string, path: string = 'iso'): number {
  if (typeof iso !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_UTC_ISO',
      path,
      message: `Expected UTC ISO string, got ${typeof iso}`,
    });
  }

  const match = UTC_ISO_STRICT_REGEX.exec(iso);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) {
    throw new TimeFoldError({
      code: 'E_INVALID_UTC_ISO',
      path,
      message: `Invalid UTC ISO minute format: expected YYYY-MM-DDTHH:mm:00Z, got "${iso}"`,
    });
  }

  const seconds = match[6];
  if (seconds !== '00') {
    throw new TimeFoldError({
      code: 'E_NON_ZERO_SECONDS',
      path,
      message: `UTC ISO string must have seconds "00", got "${seconds}" in "${iso}"`,
    });
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  if (!isValidDate(year, month, day)) {
    throw new TimeFoldError({
      code: 'E_INVALID_DATE',
      path,
      message: `Invalid calendar date in UTC ISO string: "${iso}"`,
    });
  }

  if (!isValidTime(hour, minute)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TIME',
      path,
      message: `Invalid time in UTC ISO string: "${iso}"`,
    });
  }

  const ms = toUtcMilliseconds(year, month, day, hour, minute, 0);
  const min = ms / 60000;
  if (!Number.isSafeInteger(min)) {
    throw new TimeFoldError({
      code: 'E_MINUTE_OVERFLOW',
      path,
      message: `Parsed UTC minute is not a safe integer: ${min}`,
    });
  }
  return min;
}

/**
 * 将 UTC 安全整数分钟格式化为标准的 YYYY-MM-DDTHH:mm:00Z 字符串。
 * 秒位始终为 00，纯 UTC 解析，绝不依赖系统本地时区。
 */
export function formatUtcMinute(minute: number): string {
  if (typeof minute !== 'number' || !Number.isInteger(minute) || !Number.isSafeInteger(minute)) {
    throw new TimeFoldError({
      code: 'E_INVALID_MINUTE',
      path: 'minute',
      message: `Expected safe integer minute, got: ${minute}`,
    });
  }

  const ms = minute * 60000;
  const dt = new Date(ms);
  const year = dt.getUTCFullYear();
  if (year < 0 || year > 9999) {
    throw new TimeFoldError({
      code: 'E_YEAR_OUT_OF_RANGE',
      path: 'minute',
      message: `Year out of range 0000..9999: ${year}`,
    });
  }
  const month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  const hour = dt.getUTCHours();
  const min = dt.getUTCMinutes();

  return `${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(min)}:00Z`;
}

/**
 * 严格解析墙上本地时间 YYYY-MM-DD HH:mm 为本地数字编码分钟 L。
 * 遵循 PROJECT_BOOK.md §5.1：
 * 将公历本地 YYYY-MM-DD HH:mm 视为不带时区的 L = Date.UTC(y, m-1, d, h, min) / 60000。
 */
export function parseLocalMinute(localStr: string, path: string = 'local'): number {
  if (typeof localStr !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_LOCAL_FORMAT',
      path,
      message: `Expected local date-time string, got ${typeof localStr}`,
    });
  }

  const match = LOCAL_DATETIME_REGEX.exec(localStr);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
    throw new TimeFoldError({
      code: 'E_INVALID_LOCAL_FORMAT',
      path,
      message: `Invalid local date-time format: expected YYYY-MM-DD HH:mm, got "${localStr}"`,
    });
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  if (!isValidDate(year, month, day)) {
    throw new TimeFoldError({
      code: 'E_INVALID_DATE',
      path,
      message: `Invalid calendar date in local string: "${localStr}"`,
    });
  }

  if (!isValidTime(hour, minute)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TIME',
      path,
      message: `Invalid time in local string: "${localStr}"`,
    });
  }

  const ms = toUtcMilliseconds(year, month, day, hour, minute, 0);
  const min = ms / 60000;
  if (!Number.isSafeInteger(min)) {
    throw new TimeFoldError({
      code: 'E_MINUTE_OVERFLOW',
      path,
      message: `Parsed local minute is not a safe integer: ${min}`,
    });
  }
  return min;
}

/**
 * 将本地分钟编码数字 L 格式化为墙上本地时间 YYYY-MM-DD HH:mm。
 */
export function formatLocalMinute(minute: number): string {
  if (typeof minute !== 'number' || !Number.isInteger(minute) || !Number.isSafeInteger(minute)) {
    throw new TimeFoldError({
      code: 'E_INVALID_MINUTE',
      path: 'minute',
      message: `Expected safe integer minute, got: ${minute}`,
    });
  }

  const ms = minute * 60000;
  const dt = new Date(ms);
  const year = dt.getUTCFullYear();
  if (year < 0 || year > 9999) {
    throw new TimeFoldError({
      code: 'E_YEAR_OUT_OF_RANGE',
      path: 'minute',
      message: `Year out of range 0000..9999: ${year}`,
    });
  }
  const month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  const hour = dt.getUTCHours();
  const min = dt.getUTCMinutes();

  return `${pad4(year)}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(min)}`;
}

/**
 * 组合日期和时间为 YYYY-MM-DD HH:mm
 */
export function combineLocalDateAndTime(date: string, time: string): string {
  parseDate(date);
  parseTime(time);
  return `${date} ${time}`;
}

/**
 * 拆解本地分钟为 { date: 'YYYY-MM-DD', time: 'HH:mm' }
 */
export function splitLocalMinute(minute: number): { date: string; time: string } {
  const formatted = formatLocalMinute(minute);
  const parts = formatted.split(' ');
  const date = parts[0];
  const time = parts[1];
  if (!date || !time) {
    throw new TimeFoldError({
      code: 'E_SPLIT_FAILED',
      path: 'minute',
      message: `Failed to split formatted local minute: ${formatted}`,
    });
  }
  return { date, time };
}

/**
 * 日期逐日增量（days 可为正负整数）
 * 使用 Date.UTC 毫秒计算，严格公历连续，绝不依赖 OS 本地时区。
 */
export function addDays(dateStr: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new TimeFoldError({
      code: 'E_INVALID_DAYS',
      path: 'days',
      message: `Expected integer days increment, got: ${days}`,
    });
  }
  const { year, month, day } = parseDate(dateStr);
  const baseMs = toUtcMilliseconds(year, month, day, 0, 0, 0);
  const targetMs = baseMs + days * 86400000;
  const dt = new Date(targetMs);
  const resYear = dt.getUTCFullYear();
  const resMonth = dt.getUTCMonth() + 1;
  const resDay = dt.getUTCDate();

  return `${pad4(resYear)}-${pad2(resMonth)}-${pad2(resDay)}`;
}

/**
 * 计算两个 YYYY-MM-DD 日期的公历天数差（dateB - dateA）
 */
export function diffDays(dateA: string, dateB: string): number {
  const pA = parseDate(dateA);
  const pB = parseDate(dateB);
  const msA = toUtcMilliseconds(pA.year, pA.month, pA.day, 0, 0, 0);
  const msB = toUtcMilliseconds(pB.year, pB.month, pB.day, 0, 0, 0);
  return Math.round((msB - msA) / 86400000);
}

/**
 * 计算 ISO 星期（1..7，1 为星期一 Monday，7 为星期日 Sunday）
 * 验收硬约束：2026-03-09 必须为星期一 (1)。
 */
export function getIsoWeekday(dateStr: string): number {
  const { year, month, day } = parseDate(dateStr);
  const ms = toUtcMilliseconds(year, month, day, 0, 0, 0);
  const dt = new Date(ms);
  const dayOfWeek = dt.getUTCDay(); // 0 是周日，1..6 是周一至周六
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

/**
 * 比较两个 YYYY-MM-DD 日期：
 * dateA < dateB 返回 -1，相等返回 0，dateA > dateB 返回 1
 */
export function compareDateStrings(dateA: string, dateB: string): number {
  parseDate(dateA);
  parseDate(dateB);
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}
