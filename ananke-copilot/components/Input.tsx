import React from "react";
import styles from "./Input.module.css";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={[styles.input, className].filter(Boolean).join(" ")}
        {...props}
      />
    );
  },
);
