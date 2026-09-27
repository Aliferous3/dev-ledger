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
