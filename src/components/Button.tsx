import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './controls.module.css'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'normal' | 'small'
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'normal',
  icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    variant === 'secondary' ? styles.glass : '',
    size === 'small' ? styles.small : '',
    className ?? '',
  ]
  return (
    <button type="button" className={classes.join(' ')} {...rest}>
      {icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string
  glass?: boolean
  children: ReactNode
}

export function IconButton({ label, glass, className, children, ...rest }: IconButtonProps) {
  const classes = [styles.iconButton, glass ? styles.glass : '', className ?? '']
  return (
    <button type="button" aria-label={label} title={label} className={classes.join(' ')} {...rest}>
      {children}
    </button>
  )
}
