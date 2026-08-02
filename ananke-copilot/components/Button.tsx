import React from "react";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";

export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Render the single child element instead of a <button>, merging the button's
   * classes onto it. Used by the pages to wrap react-router <Link>s.
   */
  asChild?: boolean;
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  icon: styles.icon,
  "icon-sm": styles.iconSm,
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", asChild = false, className, children, ...props },
    ref,
  ) {
    const classes = [styles.button, styles[variant], SIZE_CLASS[size], className]
      .filter(Boolean)
      .join(" ");

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string }>;
      return React.cloneElement(child, {
        className: [classes, child.props.className].filter(Boolean).join(" "),
        ...props,
      } as never);
    }

    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  },
);
