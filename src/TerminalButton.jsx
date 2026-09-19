import React from 'react'
import { Icon } from '@iconify/react'
import { tbtnClass, tbtnPrompt, tbtnCursor } from './tbtnSpec'

/* Terminal Prompt action buttons — the canonical action-control language.
   Syntax:  [icon] > label █   (danger uses `!`)
   The prompt and cursor are visual syntax, never editable text. */

export function TerminalButton({
  variant = 'secondary',
  compact = false,
  active = false,
  solid = false,
  size = null,
  loading = false,
  loadingLabel = null,
  cursor = 'auto',
  icon = null,
  href = undefined,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const Tag = href ? 'a' : 'button'
  const mode = tbtnCursor({ variant, cursor, loading })
  return (
    <Tag
      href={href}
      disabled={!href ? disabled || loading : undefined}
      aria-disabled={href && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      className={`${tbtnClass({ variant, compact, active, solid, size })}${disabled || loading ? ' tbtn-disabled' : ''} ${className}`}
      {...rest}
    >
      {icon ? <Icon icon={icon} className='tbtn-icon' aria-hidden='true' /> : null}
      <span className='tbtn-prompt' aria-hidden='true'>{tbtnPrompt(variant)}</span>
      <span className='tbtn-label'>{loading ? (loadingLabel || 'loading') : children}</span>
      {mode !== 'none' && (
        <span className={`tbtn-cursor${mode === 'blink' ? ' tbtn-cursor-blink' : ''}`} aria-hidden='true'>█</span>
      )}
    </Tag>
  )
}

/* Icon-only square control — no `>` prompt, no cursor. aria-label required. */
export function TerminalIconButton({ icon, label, bordered = false, disabled = false, className = '', children, ...rest }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`ticon${bordered ? ' ticon-bordered' : ''} ${className}`}
      {...rest}
    >
      {icon ? <Icon icon={icon} className='tbtn-icon' aria-hidden='true' /> : children}
    </button>
  )
}
