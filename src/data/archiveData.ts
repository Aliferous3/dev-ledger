import { FingerprintMetric, MonthStrata, MigrationStep } from '../types';

export const FINGERPRINT_METRICS: FingerprintMetric[] = [
  {
    id: '01',
    name: 'CREATION',
    score: 73,
    detail: '73% ADDED',
    ringRadius: 130,
    fillPct: 0.73,
  },
  {
    id: '02',
    name: 'SWEEP',
    score: 100,
    detail: '2703 LINES/COMMIT',
    ringRadius: 118,
    fillPct: 1.0,
  },
  {
    id: '03',
    name: 'FOCUS',
    score: 91,
    detail: '91% TOP REPO',
    ringRadius: 106,
    fillPct: 0.91,
  },
  {
    id: '04',
    name: 'BREADTH',
    score: 100,
    detail: '7/7 REPOS',
    ringRadius: 94,
    fillPct: 1.0,
  },
  {
    id: '05',
    name: 'DIVERSITY',
    score: 27,
    detail: '10 LANGUAGES',
    ringRadius: 82,
    fillPct: 0.27,
  },
  {
    id: '06',
    name: 'CADENCE',
    score: 100,
    detail: '24.5 COMMITS/DAY',
    ringRadius: 70,
    fillPct: 1.0,
  },
  {
    id: '07',
    name: 'DENSITY',
    score: 100,
    detail: '66223 LINES/ACTIVE-DAY',
    ringRadius: 58,
    fillPct: 1.0,
  },
  {
    id: '08',
    name: 'PR SHARE',
    score: 24,
    detail: '439 PRS',
    ringRadius: 46,
    fillPct: 0.24,
  },
  {
    id: '09',
    name: 'SPREAD',
    score: 16,
    detail: '58/365 DAYS',
    ringRadius: 34,
    fillPct: 0.16,
  },
];

// 33 months: Jan 2024 to Sep 2026
export const ARCHIVE_MONTHS = [
  'JAN 24', 'FEB 24', 'MAR 24', 'APR 24', 'MAY 24', 'JUN 24', 'JUL 24', 'AUG 24', 'SEP 24', 'OCT 24', 'NOV 24', 'DEC 24',
  'JAN 25', 'FEB 25', 'MAR 25', 'APR 25', 'MAY 25', 'JUN 25', 'JUL 25', 'AUG 25', 'SEP 25', 'OCT 25', 'NOV 25', 'DEC 25',
  'JAN 26', 'FEB 26', 'MAR 26', 'APR 26', 'MAY 26', 'JUN 26', 'JUL 26', 'AUG 26', 'SEP 26'
];

export const LANGUAGE_STRATA: MonthStrata[] = [
  {
    language: 'TYPESCRIPT',
    peakPct: 84.7,
    // active in May 26 (m28), Jul 26 (m30), Aug 26 (m31), Sep 26 (m32)
    activeMonths: Array.from({ length: 33 }, (_, i) => [28, 30, 31, 32].includes(i)),
  },
  {
    language: 'PYTHON',
    peakPct: 8.6,
    // active in Jun 26 (m29), Jul 26 (m30), Aug 26 (m31)
    activeMonths: Array.from({ length: 33 }, (_, i) => [29, 30, 31].includes(i)),
  },
  {
    language: 'JAVASCRIPT',
    peakPct: 4.2,
    activeMonths: Array.from({ length: 33 }, (_, i) => [28, 29, 30, 31, 32].includes(i)),
  },
  {
    language: 'POWERSHELL',
    peakPct: 1.2,
    activeMonths: Array.from({ length: 33 }, (_, i) => [29, 30, 31, 32].includes(i)),
  },
  {
    language: 'CSS',
    peakPct: 0.8,
    activeMonths: Array.from({ length: 33 }, (_, i) => [31, 32].includes(i)),
  },
  {
    language: 'C++',
    peakPct: 0.5,
    activeMonths: Array.from({ length: 33 }, (_, i) => [30].includes(i)),
  },
  {
    language: 'HTML',
    peakPct: 0.2,
    activeMonths: Array.from({ length: 33 }, (_, i) => [31].includes(i)),
  },
  {
    language: 'JAVA',
    peakPct: 0.1,
    activeMonths: Array.from({ length: 33 }, (_, i) => [0].includes(i)),
  },
];

export const MIGRATION_STEPS: MigrationStep[] = [
  { repoName: 'Aliferous3', months: 1, isDominant: true },
  { repoName: 'lexica-aeterna', months: 1, isDominant: true },
  { repoName: 'gold-bot', months: 2, isDominant: true, isShared: true },
  { repoName: 'lexica-aeterna', months: 2, isDominant: true },
];

export const BODY_OF_WORK_METRICS = [
  { label: 'FIRST OBSERVED', value: '2024-01-01' },
  { label: 'LATEST OBSERVED', value: '2026-09-20' },
  { label: 'OBSERVED SPAN', value: '2Y 9M' },
  { label: 'TOTAL COMMITS', value: '1,493' },
  { label: 'ACTIVE DAYS', value: '89' },
  { label: 'REPOSITORIES', value: '7' },
  { label: 'ACTIVE / REVIVED', value: '5 / 0' },
  { label: 'LANGUAGES OBSERVED', value: '10' },
];
