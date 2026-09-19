/* Pure variant logic for the Terminal Prompt button system — kept JSX-free
   so the node:test suite can exercise it directly. */

export const TB_PROMPT = {
  primary: '>',
  secondary: '>',
  danger: '!',
}

/* Which variants are allowed a blinking cursor — only the dominant CTA of a
   region should blink; secondary/compact/icon stay static. */
export const TB_BLINK_OK = { primary: true, secondary: false, danger: false }

export function tbtnClass({ variant = 'secondary', compact = false, active = false, solid = false, size = null } = {}) {
  const v = TB_PROMPT[variant] ? variant : 'secondary'
  return [
    'tbtn',
    `tbtn-${v}`,
    compact ? 'tbtn-compact' : '',
    active ? 'tbtn-active' : '',
    solid ? 'tbtn-solid' : '',
    size === 'lg' ? 'tbtn-lg' : '',
  ].filter(Boolean).join(' ')
}

export function tbtnPrompt(variant = 'secondary') {
  return TB_PROMPT[variant] || TB_PROMPT.secondary
}

/* cursor: none | static | blink — resolved from variant + caller intent */
export function tbtnCursor({ variant = 'secondary', cursor = 'auto', loading = false } = {}) {
  if (loading) return 'blink'
  if (cursor === 'none') return 'none'
  if (cursor === 'static' || cursor === 'blink') {
    return cursor === 'blink' && !TB_BLINK_OK[variant] ? 'static' : cursor
  }
  return variant === 'primary' ? 'blink' : 'none'
}
