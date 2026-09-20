import { DailyPoint, Period } from '../types';

export const START_DATE = new Date(2025, 8, 21); // Sep 21, 2025
export const END_DATE = new Date(2026, 8, 20);   // Sep 20, 2026
const TOTAL_DAYS = 365;

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

// Generate the 365 daily points
export function generateMeasureData(): DailyPoint[] {
  const points: DailyPoint[] = [];
  let cumGrowth = 0;
  let cumAdded = 0;
  let cumDeleted = 0;
  let cumCommits = 0;

  for (let i = 0; i < TOTAL_DAYS; i++) {
    const curDate = new Date(START_DATE.getTime() + i * 86400000);
    const dateStr = formatDate(curDate);

    // Activity distribution: early period is sparse/low, intense ramp in days 320..364 (Aug..Sep 2026)
    let dailyGrowth = 0;
    let dailyAdded = 0;
    let dailyDeleted = 0;
    let dailyCommits = 0;

    if (i < 240) {
      // Sporadic small bursts
      if (i % 38 === 0 || i % 55 === 0) {
        dailyCommits = Math.floor(2 + (i % 5));
        dailyAdded = Math.floor(400 + (i * 12) % 1800);
        dailyDeleted = Math.floor(dailyAdded * 0.15);
        dailyGrowth = dailyAdded - dailyDeleted;
      }
    } else if (i < 310) {
      // Moderate ramp up starting June/July
      if (i % 7 === 0 || i % 11 === 0 || i > 290) {
        dailyCommits = Math.floor(4 + ((i * 3) % 12));
        dailyAdded = Math.floor(3200 + ((i * 70) % 9000));
        dailyDeleted = Math.floor(dailyAdded * 0.2);
        dailyGrowth = dailyAdded - dailyDeleted;
      }
    } else {
      // Days 310 to 364 (August to September 2026) - Massive surge matching screenshot!
      const surgeFactor = (i - 310) / 54; // 0 to 1
      dailyCommits = Math.floor(15 + surgeFactor * 48 + ((i * 7) % 15));
      dailyAdded = Math.floor(28000 + surgeFactor * 95000 + ((i * 340) % 45000));
      // Add a couple of peak spike days
      if (i === 350 || i === 360 || i === 363) {
        dailyAdded += 185000;
        dailyCommits += 40;
      }
      dailyDeleted = Math.floor(dailyAdded * 0.12);
      dailyGrowth = dailyAdded - dailyDeleted;
    }

    cumGrowth += dailyGrowth;
    cumAdded += dailyAdded;
    cumDeleted += dailyDeleted;
    cumCommits += dailyCommits;

    const churn =
      dailyAdded + dailyDeleted > 0
        ? parseFloat(((dailyDeleted / (dailyAdded + dailyDeleted)) * 100).toFixed(1))
        : 0;

    points.push({
      date: dateStr,
      dayIndex: i,
      growth: dailyGrowth,
      cumulativeGrowth: cumGrowth,
      added: dailyAdded,
      cumulativeAdded: cumAdded,
      deleted: dailyDeleted,
      cumulativeDeleted: cumDeleted,
      churn,
      commits: dailyCommits,
      cumulativeCommits: cumCommits,
    });
  }

  // Normalize final growth to exactly match the screenshot's +1,756,748
  const target = 1756748;
  const currentTotal = points[points.length - 1].cumulativeGrowth;
  const scale = target / (currentTotal || 1);

  let reCumGrowth = 0;
  for (const pt of points) {
    pt.growth = Math.round(pt.growth * scale);
    reCumGrowth += pt.growth;
    pt.cumulativeGrowth = reCumGrowth;
  }
  points[points.length - 1].cumulativeGrowth = target;

  return points;
}

export const MEASURE_DATA: DailyPoint[] = generateMeasureData();

export function filterPointsByPeriod(points: DailyPoint[], period: Period): DailyPoint[] {
  const total = points.length;
  switch (period) {
    case '7D':
      return points.slice(Math.max(0, total - 7));
    case '30D':
      return points.slice(Math.max(0, total - 30));
    case '90D':
      return points.slice(Math.max(0, total - 90));
    case 'YTD': {
      // From Jan 1, 2026 to Sep 20, 2026
      return points.filter((p) => p.date >= '2026-01-01');
    }
    case '1Y':
    case 'ALL':
    default:
      return points;
  }
}
