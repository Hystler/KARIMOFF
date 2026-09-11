"use client";

import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import styles from "./OperationsWorkspace.module.css";

export function OperationsSubmitButton({ children, className, disabled, ...props }: Omit<ComponentProps<"button">, "type">) {
  const { pending } = useFormStatus();

  return (
    <button {...props} type="submit" className={`${styles.submitButton} ${className ?? styles.primary}`} disabled={disabled || pending} aria-busy={pending}>
      <span className={styles.submitLabel} style={pending ? { visibility: "hidden" } : undefined} aria-hidden={pending || undefined}>{children}</span>
      {pending ? <span className={styles.submitPending}><LoaderCircle size={16} className={styles.spinner} /><span className="sr-only">Выполняется</span></span> : null}
    </button>
  );
}
