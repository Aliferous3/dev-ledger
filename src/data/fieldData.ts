export interface FieldStatSummary {
  commits: number;
  prs: number;
  activeDays: number;
  mergedPrs: number;
  longestStreak: number;
  repositories: number;
  spanDays: number;
}

export interface ContributionCell {
  date: string;
  dayOfWeek: number; // 0 (Sun) to 6 (Sat)
  weekIndex: number; // 0 to 52
  commits: number;
  added: number;
  deleted: number;
  prs: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface LanguageComposition {
  name: string;
  bytes: number;
  percentage: number;
  color: string;
}

export const LANGUAGES: LanguageComposition[] = [
  { name: 'TypeScript', bytes: 8_300_000, percentage: 84.7, color: '#f5f5f5' },
  { name: 'Python', bytes: 845_500, percentage: 8.6, color: '#888888' },
  { name: 'JavaScript', bytes: 412_000, percentage: 4.2, color: '#666666' },
  { name: 'CSS', bytes: 142_000, percentage: 1.4, color: '#444444' },
  { name: 'C++', bytes: 64_000, percentage: 0.7, color: '#333333' },
  { name: 'Shell', bytes: 38_000, percentage: 0.4, color: '#222222' },
];

export const TOTAL_LANG_BYTES = LANGUAGES.reduce((acc, l) => acc + l.bytes, 0);

export const MONTH_NAMES = [
  'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP'
];

export const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function generateFieldCells(): { cells: ContributionCell[]; weeks: (ContributionCell | null)[][] } {
  const cells: ContributionCell[] = [];
  const startDate = new Date(2025, 8, 21); // Sep 21, 2025 (Sunday)
  const totalWeeks = 53;
  const weeks: (ContributionCell | null)[][] = Array.from({ length: totalWeeks }, () =>
    Array(7).fill(null)
  );

  let activeDayCount = 0;

  for (let w = 0; w < totalWeeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dayOffset = w * 7 + d;
      if (dayOffset > 365) continue;

      const dateObj = new Date(startDate.getTime() + dayOffset * 86400000);
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;

      let commits = 0;
      let added = 0;
      let deleted = 0;
      let prs = 0;
      let intensity: 0 | 1 | 2 | 3 | 4 = 0;

      // Match the exact cluster distribution in the screenshot:
      // Sporadic single days in May, June, July, then dense August & September
      const isLateYear = dayOffset >= 300; // August-September
      const isMayJune = dayOffset >= 240 && dayOffset < 300;
      const isSporadic = (w === 8 && d === 2) || (w === 18 && d === 4) || (w === 24 && d === 1) || (w === 35 && d === 3) || (w === 39 && d === 5) || (w === 39 && d === 6);

      if (isLateYear) {
        // High activity ending in streak
        if (dayOffset >= 342) {
          // 23 day streak up to Sep 20
          commits = Math.floor(18 + ((dayOffset * 7) % 36));
          added = commits * 680;
          deleted = Math.floor(added * 0.14);
          prs = Math.floor(commits * 0.32);
          intensity = commits > 35 ? 4 : commits > 25 ? 3 : 2;
          activeDayCount++;
        } else if ((w + d) % 2 === 0 || d > 2) {
          commits = Math.floor(8 + ((dayOffset * 5) % 24));
          added = commits * 450;
          deleted = Math.floor(added * 0.18);
          prs = Math.floor(commits * 0.28);
          intensity = commits > 20 ? 3 : commits > 10 ? 2 : 1;
          activeDayCount++;
        }
      } else if (isMayJune) {
        if ((w === 35 && d === 3) || (w === 39 && d >= 4) || (w === 43 && d === 1) || (w === 44 && d === 2)) {
          commits = 12 + (d % 6);
          added = commits * 320;
          deleted = Math.floor(added * 0.1);
          prs = 3;
          intensity = 2;
          activeDayCount++;
        }
      } else if (isSporadic) {
        commits = 4;
        added = 420;
        deleted = 0;
        prs = 1;
        intensity = 1;
        activeDayCount++;
      }

      const cell: ContributionCell = {
        date: dateStr,
        dayOfWeek: d,
        weekIndex: w,
        commits,
        added,
        deleted,
        prs,
        intensity,
      };

      cells.push(cell);
      weeks[w][d] = cell;
    }
  }

  return { cells, weeks };
}

export const FIELD_GRID = generateFieldCells();
