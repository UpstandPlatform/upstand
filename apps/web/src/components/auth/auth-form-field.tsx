import type { AnyFieldApi } from "@tanstack/react-form";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import type { ChangeEvent } from "react";

interface AuthFormFieldProps {
  field: AnyFieldApi;
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}

export function AuthFormField({
  field,
  label,
  type = "text",
  placeholder,
  autoComplete,
  required = true,
}: AuthFormFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          field.handleChange(e.target.value)
        }
      />
      {field.state.meta.errors.map((error: unknown) => (
        <p
          key={errorMessage(error)}
          className="text-destructive text-xs"
          role="alert"
        >
          {errorMessage(error)}
        </p>
      ))}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
