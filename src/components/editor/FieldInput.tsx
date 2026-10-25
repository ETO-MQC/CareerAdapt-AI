"use client";

import { FieldFormatting } from "./FieldFormatting";
import { DatePicker } from "./DatePicker";
import { useId } from "react";

type FieldInputProps = {
  label: string;
  formatField?: string;
  calendar?: boolean;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "email" | "tel" | "url" | "date" | "month";
  inputMode?: "text" | "email" | "tel" | "url" | "numeric";
  hint?: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
};

export function FieldInput({
  label,
  formatField,
  calendar,
  id: externalId,
  value,
  onChange,
  onBlur,
  onFocus,
  placeholder,
  disabled,
  type = "text",
  inputMode,
  hint,
  error,
  required,
  autoComplete,
  className
}: FieldInputProps) {
  const autoId = useId();
  const fieldId = externalId ?? autoId;
  const errorId = `${fieldId}-error`;

  return (
    <div className={`field-input-group ${className ?? ""}`}>
      <label htmlFor={fieldId} className="field-input-label">
        {label}
        {required ? <span className="field-input-required" aria-label="必填">*</span> : null}
      </label>
      <FieldFormatting field={formatField ?? fieldId.split("-").at(-1)!} value={value} label={label} onDelete={disabled ? undefined : () => onChange("")}>
      <div className={calendar ? "date-text-input" : undefined}><input
        id={fieldId}
        name={fieldId}
        type={type}
        inputMode={inputMode}
        className={`field-input ${error ? "field-input-error-state" : ""}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
      />
      {calendar ? <DatePicker label={label} value={value} onChange={onChange} disabled={disabled}/> : null}</div></FieldFormatting>
      {hint && !error ? <p className="field-input-hint">{hint}</p> : null}
      {error ? <p id={errorId} className="field-input-error" role="alert">{error}</p> : null}
    </div>
  );
}
