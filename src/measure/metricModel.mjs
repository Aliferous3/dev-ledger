export const METRIC_META = Object.freeze({
  GROWTH: {
    figureTitle: 'CUMULATIVE NET SOURCE GROWTH',
    monthTitle: 'NET CHANGE BY MONTH · DAY DETAIL',
  },
  ADDED: {
    figureTitle: 'CUMULATIVE LINES ADDED',
    monthTitle: 'LINES ADDED BY MONTH · DAY DETAIL',
  },
  DELETED: {
    figureTitle: 'CUMULATIVE LINES DELETED',
    monthTitle: 'LINES DELETED BY MONTH · DAY DETAIL',
  },
  CHURN: {
    figureTitle: 'CUMULATIVE SOURCE CHURN',
    monthTitle: 'SOURCE CHURN BY MONTH · DAY DETAIL',
  },
  COMMITS: {
    figureTitle: 'CUMULATIVE COMMITS',
    monthTitle: 'COMMITS BY MONTH · DAY DETAIL',
  },
});

export function metricDailyValue(day, metric) {
  switch (metric) {
    case 'ADDED':
      return Number(day.added) || 0;
    case 'DELETED':
      return Number(day.deleted) || 0;
    case 'CHURN':
      return (Number(day.added) || 0) + (Number(day.deleted) || 0);
    case 'COMMITS':
      return Number(day.commits) || 0;
    case 'GROWTH':
    default:
      return Number(day.dailyChange) || 0;
  }
}

export function buildMetricSeries(days, metric) {
  let cum = 0;
  return days.map((day, i) => {
    const daily = metricDailyValue(day, metric);
    cum += daily;
    return {
      i,
      date: day.date,
      daily,
      cum,
      added: Number(day.added) || 0,
      deleted: Number(day.deleted) || 0,
      commits: Number(day.commits) || 0,
    };
  });
}

export function centeredMean3(values) {
  return values.map((_, i) => {
    const start = Math.max(0, i - 1);
    const end = Math.min(values.length, i + 2);
    const window = values.slice(start, end);
    return window.reduce((sum, value) => sum + value, 0) / Math.max(1, window.length);
  });
}

export function resampleSeries(values, count = 96) {
  if (values.length === 0 || count <= 0) return [];
  if (values.length === 1) return Array.from({ length: count }, () => values[0]);
  if (count === 1) return [values[values.length - 1]];

  const last = values.length - 1;
  return Array.from({ length: count }, (_, i) => {
    const pos = (i / (count - 1)) * last;
    const lo = Math.floor(pos);
    const hi = Math.min(last, Math.ceil(pos));
    const mix = pos - lo;
    return values[lo] + (values[hi] - values[lo]) * mix;
  });
}
