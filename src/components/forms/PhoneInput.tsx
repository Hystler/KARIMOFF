"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import { formatRussianPhoneInput } from "@/lib/phone";

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "value">;

export function PhoneInput({ className = "", defaultValue = "", onChange, ...props }: PhoneInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [displayValue, setDisplayValue] = useState(() =>
    defaultValue ? formatRussianPhoneInput(String(defaultValue)) : ""
  );

  return (
    <input
      {...props}
      ref={inputRef}
      type="tel"
      inputMode="tel"
      autoComplete={props.autoComplete ?? "tel"}
      value={displayValue}
      placeholder={props.placeholder ?? "+7 (999) 123-45-67"}
      className={className}
      onChange={(event) => {
        const nextValue = formatRussianPhoneInput(event.currentTarget.value);
        setDisplayValue(nextValue);
        onChange?.(event);

        requestAnimationFrame(() => {
          inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
        });
      }}
    />
  );
}
