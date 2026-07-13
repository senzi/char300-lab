export const writingYearDays = 365;

export type WritingYear = {
  index: number;
  startKey: string;
  endKey: string;
  current: boolean;
};

export function getWritingYearRange(firstDay: string, index: number): Omit<WritingYear, "current"> {
  const safeIndex = Math.max(Math.floor(index), 0);
  const startKey = firstDay;
  return {
    index: safeIndex,
    startKey,
    endKey: addCalendarDays(startKey, writingYearDays - 1)
  };
}

export function getWritingYears(writtenDateKeys: string[], today: string): WritingYear[] {
  const keys = [...new Set(writtenDateKeys)].sort();
  const years: WritingYear[] = [];
  let cursor = 0;

  while (cursor < keys.length) {
    const startKey = keys[cursor];
    const range = getWritingYearRange(startKey, 0);
    years.push({
      index: years.length,
      startKey: range.startKey,
      endKey: range.endKey,
      current: today >= range.startKey && today <= range.endKey
    });
    while (cursor < keys.length && keys[cursor] <= range.endKey) {
      cursor += 1;
    }
  }

  return years;
}

export function dateKeyInRange(key: string, startKey: string, endKey: string): boolean {
  return key >= startKey && key <= endKey;
}

export function addCalendarDays(key: string, days: number): string {
  const date = parseUtcDateKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toUtcDateKey(date);
}

function parseUtcDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toUtcDateKey(date: Date): string {
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}
