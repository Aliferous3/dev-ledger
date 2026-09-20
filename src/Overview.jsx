import React from 'react'
import QuietOverview from './QuietOverview'

/* The Overview is a scroll-driven Quiet Instrument: four chapters —
   MEASURE → FIELD → INDEX → ARCHIVE — rendered as pinned stages scrubbed by
   scroll progress (desktop), or a normal stacked document under reduced
   motion / narrow viewports. All data wiring lives in QuietOverview; props
   are unchanged from the previous stacked layout. */
export default function Overview(props) {
  return <QuietOverview {...props} />
}
