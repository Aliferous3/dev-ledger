import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMetricSeries, centeredMean3, METRIC_META, resampleSeries } from '../src/measure/metricModel.mjs';
import { timelineEndIso } from '../src/ledger/periods.ts';

const DAYS = [
  { date: '2026-09-01', dailyChange: 7, added: 10, deleted: 3, commits: 2 },
  { date: '2026-09-02', dailyChange: -2, added: 1, deleted: 3, commits: 1 },
];

test('measure graph follows every metric tab with matching cumulative series', () => {
  assert.deepEqual(buildMetricSeries(DAYS, 'GROWTH').map((d) => [d.daily, d.cum]), [[7, 7], [-2, 5]]);
  assert.deepEqual(buildMetricSeries(DAYS, 'ADDED').map((d) => [d.daily, d.cum]), [[10, 10], [1, 11]]);
  assert.deepEqual(buildMetricSeries(DAYS, 'DELETED').map((d) => [d.daily, d.cum]), [[3, 3], [3, 6]]);
  assert.deepEqual(buildMetricSeries(DAYS, 'CHURN').map((d) => [d.daily, d.cum]), [[13, 13], [4, 17]]);
  assert.deepEqual(buildMetricSeries(DAYS, 'COMMITS').map((d) => [d.daily, d.cum]), [[2, 2], [1, 3]]);
});

test('measure graph titles change with the active metric', () => {
  assert.equal(METRIC_META.GROWTH.figureTitle, 'CUMULATIVE NET SOURCE GROWTH');
  assert.equal(METRIC_META.ADDED.figureTitle, 'CUMULATIVE LINES ADDED');
  assert.equal(METRIC_META.DELETED.figureTitle, 'CUMULATIVE LINES DELETED');
  assert.equal(METRIC_META.CHURN.figureTitle, 'CUMULATIVE SOURCE CHURN');
  assert.equal(METRIC_META.COMMITS.figureTitle, 'CUMULATIVE COMMITS');
});

test('live timeline ends at the selected range end or today, never last activity', () => {
  assert.equal(timelineEndIso('2026-09-27', null, '2026-09-28'), '2026-09-27');
  assert.equal(timelineEndIso(null, null, '2026-09-28'), '2026-09-28');

  const store = readFileSync(new URL('../src/store/live.ts', import.meta.url), 'utf8');
  assert.match(store, /timelineEndIso\(dash\.range\.to, all\.range\.to, isoToday\(\)\)/);
  assert.match(store, /daysFromDaily\(all\.daily, endIso\)/);
});

test('overview passes the selected metric into MonthBins', () => {
  const section = readFileSync(new URL('../src/components/Section01Measure.tsx', import.meta.url), 'utf8');
  assert.match(section, /<MonthBins days=\{filteredDays\} metric=\{activeTab\} \/>/);
});


test('line 07 companion is a 3-day centred mean and resamples to stable path topology', () => {
  const mean = centeredMean3([2, 8, 5, 1]);
  assert.deepEqual(mean, [5, 5, 14 / 3, 3]);

  const sampled = resampleSeries([0, 10, 20], 96);
  assert.equal(sampled.length, 96);
  assert.equal(sampled[0], 0);
  assert.equal(sampled[95], 20);
});

test('MonthBins renders only the soft-white daily companion line and morphs graph paths', () => {
  const monthBins = readFileSync(new URL('../src/components/MonthBins.tsx', import.meta.url), 'utf8');
  assert.match(monthBins, /const DAILY_STROKE = '#f0f0ec'/);
  assert.match(monthBins, /centeredMean3\(series\.map\(\(d\) => d\.daily\)\)/);
  assert.match(monthBins, /animate=\{\{ d: dailyLine \}\}/);
  assert.match(monthBins, /animate=\{\{ d: line \}\}/);
  assert.match(monthBins, /duration: 0\.62/);
  assert.doesNotMatch(monthBins, /DAILY · 3D MEAN/);
});
