import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import isoWeek from 'dayjs/plugin/isoWeek';
import isBetween from 'dayjs/plugin/isBetween';

dayjs.extend(utc);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);

export interface WeekRange {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
}

/**
 * 获取指定日期所在周刊周期的周日和周六。
 * 历史周刊数据按周日到周六排期，自动化也必须沿用这个周期，
 * 否则会把同一期的日期推迟一天或制造空档。
 * @param date 日期，默认为当前日期
 * @returns 周日和周六的日期
 */
export function getWeekRange(date?: Date | string | Dayjs): WeekRange {
  const d = dayjs(date).utc();
  const adjusted = d.add(1, 'day');
  const sunday = adjusted.isoWeekday(1).subtract(1, 'day').startOf('day');
  const saturday = sunday.add(6, 'day').startOf('day');

  return {
    startDate: sunday.toDate(),
    endDate: saturday.toDate(),
    startDateStr: sunday.format('YYYY-MM-DD'),
    endDateStr: saturday.format('YYYY-MM-DD'),
  };
}

/**
 * 判断日期是否在指定的周刊时间范围内
 * @param date 要检查的日期
 * @param startDate 周刊开始日期
 * @param endDate 周刊结束日期
 * @returns 是否在范围内
 */
export function isDateInWeeklyRange(
  date: Date | string,
  startDate: Date | string,
  endDate: Date | string
): boolean {
  const d = dayjs(date).utc();
  const start = dayjs(startDate).utc().startOf('day');
  const end = dayjs(endDate).utc().endOf('day');

  return d.isBetween(start, end, null, '[]');
}

/**
 * 判断周刊是否为当前周
 * @param startDate 周刊开始日期
 * @param endDate 周刊结束日期
 * @returns 是否为当前周
 */
export function isCurrentWeek(
  startDate: Date | string,
  endDate: Date | string
): boolean {
  const now = dayjs().utc();
  return isDateInWeeklyRange(now.toDate(), startDate, endDate);
}

/**
 * 根据日期计算应该归属的周刊期号范围
 * @param date 日期
 * @returns 周刊的开始和结束日期
 */
export function getWeeklyRangeForDate(date: Date | string): WeekRange {
  return getWeekRange(date);
}

/**
 * 计算两个日期之间相差的周数
 * @param date1 日期1
 * @param date2 日期2
 * @returns 相差的周数（可为负数）
 */
export function getWeeksDiff(
  date1: Date | string,
  date2: Date | string
): number {
  const d1 = dayjs(date1).utc().add(1, 'day').startOf('isoWeek');
  const d2 = dayjs(date2).utc().add(1, 'day').startOf('isoWeek');
  return d1.diff(d2, 'week');
}

/**
 * 获取指定周偏移量的周范围
 * @param offset 周偏移量，0 为本周，-1 为上周，1 为下周
 * @returns 周范围
 */
export function getWeekRangeByOffset(offset: number = 0): WeekRange {
  const targetDate = dayjs().utc().add(offset, 'week');
  return getWeekRange(targetDate);
}

/**
 * 格式化周刊时间范围显示
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @returns 格式化的字符串，如 "01-27 ~ 02-02"
 */
export function formatWeeklyRange(
  startDate: Date | string,
  endDate: Date | string
): string {
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  if (start.year() === end.year()) {
    if (start.month() === end.month()) {
      return `${start.format('MM-DD')} ~ ${end.format('DD')}`;
    }
    return `${start.format('MM-DD')} ~ ${end.format('MM-DD')}`;
  }
  return `${start.format('YYYY-MM-DD')} ~ ${end.format('YYYY-MM-DD')}`;
}

/**
 * 生成周刊标题
 * @param issueNumber 期号
 * @returns 标题
 */
export function generateWeeklyTitle(issueNumber: number): string {
  return `我不知道的周刊第 ${issueNumber} 期`;
}

/**
 * 生成周刊 slug
 * @param issueNumber 期号
 * @returns slug
 */
export function generateWeeklySlug(issueNumber: number): string {
  return `issue-${issueNumber}`;
}
