import type { Version } from "./types.ts";

export const overviewExportTrackWidth = 970;

export function getRevisionTotals(versions: Pick<Version, "diff_from_previous">[]): { inserted: number; deleted: number } {
  let inserted = 0;
  let deleted = 0;

  for (const version of versions.slice(1)) {
    for (const unit of version.diff_from_previous) {
      if (unit.op === "INSERT") {
        inserted += 1;
      } else if (unit.op === "DELETE") {
        deleted += 1;
      }
    }
  }

  return { inserted, deleted };
}

export function getOverviewExportBarLayout(dayCount: number): { barGap: number; barWidth: number; startOffset: number } {
  const count = Math.max(dayCount, 1);
  const barWidth = count > 180 ? 1 : Math.max(4, Math.min(14, overviewExportTrackWidth / count / 2));
  if (count === 1) {
    return { barGap: 0, barWidth, startOffset: (overviewExportTrackWidth - barWidth) / 2 };
  }
  const barGap = (overviewExportTrackWidth - count * barWidth) / (count - 1);
  return { barGap, barWidth, startOffset: 0 };
}

export type OverviewMonthMarker = {
  column: number;
  label: string;
};

export function getOverviewMonthMarkers(dateKeys: string[]): OverviewMonthMarker[] {
  const markers: OverviewMonthMarker[] = [];
  let previousMonth = "";
  let previousColumn = -1;

  dateKeys.forEach((key, index) => {
    const month = key.slice(0, 7);
    if (month === previousMonth) {
      return;
    }
    const column = Math.max(Math.floor(index / 7), previousColumn + 1);
    markers.push({ column, label: `${Number(key.slice(5, 7))}月` });
    previousMonth = month;
    previousColumn = column;
  });

  return markers;
}
