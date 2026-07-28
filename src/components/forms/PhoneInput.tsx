"use client";

import type { InputHTMLAttributes } from "react";
import { formatRussianPhoneInput } from "@/lib/phone";

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode">;

export function PhoneInput({ className = "", defaultValue = "", onChange, ...props }: PhoneInputProps) {
  return (
    <input
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete={props.autoComplete ?? "tel"}
      defaultValue={defaultValue}
      placeholder={props.placeholder ?? "+7 (999) 123-45-67"}
      className={className}
      onChange={(event) => {
        event.currentTarget.value = formatRussianPhoneInput(event.currentTarget.value);
        onChange?.(event);
      }}
      onPaste={(event) => {
        event.preventDefault();
        const value = event.clipboardData.getData("text");
        event.currentTarget.value = formatRussianPhoneInput(value);
        event.currentTarget.dispatchEvent(new Event("input", { bubbles: true }));
      }}
    />
  );
}
