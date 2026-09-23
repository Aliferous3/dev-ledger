// DEV-ONLY fixture barrel — the single entry point for all bundled demo
// data. In production builds vite.config.ts aliases this module to
// ./stub.ts, so none of the modules below (or the data they contain)
// ever reach the shipped bundle.

export {
  DASHBOARD,
  OBS_START,
  OBS_END,
  ARCHIVE_RANGE,
  MONTH_SPAN,
} from './ledgerData';
export {
  DATA_365,
  REPOSITORIES,
  FINGERPRINT_METRICS,
  SUCCESSION_LANGUAGES,
  MIGRATION_CARDS,
  SPAN_STATS,
  START_DATE,
  END_DATE,
  generate365Days,
} from './metricsData';
export { START, END, cells, weeks, languages, languageTotal } from './field';
export { LANGUAGES, LANGUAGE_TOTAL_BYTES } from './code';
export {
  ACTIVITY_TOTALS,
  EXTREMES,
  MILESTONES,
  MONTH_COMMITS,
  MOST_ACTIVE_MONTHS,
  RHYTHM_DAYS,
  RHYTHM_WINDOWS,
  RHYTHM_HIGHLIGHTS,
  RHYTHM_MATRIX,
} from './activity';
