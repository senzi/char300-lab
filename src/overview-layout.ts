export const overviewExportTrackWidth = 970;

export function getOverviewExportBarLayout(dayCount: number): { barGap: number; barWidth: number } {
  const count = Math.max(dayCount, 1);
  const barGap = count > 180 ? 1 : 2;
  const barWidth = Math.max(1, Math.min(14, (overviewExportTrackWidth - (count - 1) * barGap) / count));
  return { barGap, barWidth };
}
