import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SharedCheckboxes, SharedOptionElements } from "@/components/shared-options";

export function TextField({
  name,
  label,
  defaultValue,
  type = "text",
  required = true,
  step,
}: {
  name: string;
  label: string;
  defaultValue?: string | number;
  type?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        required={required}
      />
    </div>
  );
}

export function CustomFields({
  defs,
  values,
}: {
  defs: { key: string; label: string }[];
  values?: Record<string, string>;
}) {
  return (
    <>
      {defs.map((d) => (
        <TextField
          key={d.key}
          name={`cf_${d.key}`}
          label={d.label}
          required={false}
          defaultValue={values?.[d.key]}
        />
      ))}
    </>
  );
}

export function TextAreaField({
  name,
  label,
  defaultValue,
  required = false,
  rows = 4,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        className={cn(
          "flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
          "dark:bg-input/30",
        )}
      />
    </div>
  );
}

export function MultiSelectField({
  name,
  label,
  options,
  defaultValues = [],
}: {
  name: string;
  label: string;
  /** nexrees: the options, or the name of a list from <SharedOptionsProvider>. */
  options: { value: string; label: string }[] | string;
  defaultValues?: string[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-input p-2 dark:bg-input/30">
        {typeof options === "string" ? (
          <SharedCheckboxes list={options} name={name} defaultValues={defaultValues} />
        ) : (
          <SharedCheckboxes options={options} name={name} defaultValues={defaultValues} />
        )}
      </div>
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  leading = [],
  defaultValue,
}: {
  name: string;
  label: string;
  /** nexrees: the options, or the name of a list from <SharedOptionsProvider>. */
  options: { value: string; label: string }[] | string;
  /** Options shown before `options`, e.g. "none". */
  leading?: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
          "dark:bg-input/30",
        )}
      >
        {leading.map((o) => (
          <option key={`lead-${o.value}`} value={o.value}>
            {o.label}
          </option>
        ))}
        {typeof options === "string" ? (
          <SharedOptionElements list={options} />
        ) : (
          options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
