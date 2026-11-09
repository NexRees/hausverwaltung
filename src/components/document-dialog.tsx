import { Upload, Pencil } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { CrudDialog } from "@/components/crud-dialog";
import { TextField, SelectField } from "@/components/form-fields";
import { uploadDocument, updateDocument } from "@/server/actions/documents";
import { DOCUMENT_CATEGORIES as CATS } from "@/lib/schemas";

// nexrees: option props may name a shared list (components/shared-options.tsx)
type Opt = { value: string; label: string };

type DocData = {
  id: string;
  name: string;
  category: string;
  propertyId: string | null;
  unitId: string | null;
  personId: string | null;
};

export async function DocumentDialog({
  properties,
  units,
  persons,
  doc,
}: {
  properties: Opt[] | string;
  units: Opt[] | string;
  persons: Opt[] | string;
  doc?: DocData; // gesetzt = Bearbeiten statt Hochladen
}) {
  const t = await getTranslations();
  const catOpts = await getTranslations("documentCategory").then((tt) =>
    CATS.map((k) => ({ value: k, label: tt(k) })),
  );
  const edit = !!doc;
  return (
    <CrudDialog
      trigger={
        edit ? (
          <Button variant="ghost" size="icon" aria-label={t("common.edit")} title={t("common.edit")}>
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Upload className="size-4" />
            {t("documents.upload")}
          </Button>
        )
      }
      title={edit ? t("documents.edit") : t("documents.upload")}
      action={edit ? updateDocument : uploadDocument}
      submitLabel={edit ? t("common.save") : t("documents.upload")}
    >
      {edit ? (
        <input type="hidden" name="id" value={doc!.id} />
      ) : (
        <TextField name="file" label={t("documents.file")} type="file" />
      )}
      <TextField name="name" label={t("fields.name")} required={edit} defaultValue={doc?.name} />
      <SelectField
        name="category"
        label={t("documents.category")}
        options={catOpts}
        defaultValue={doc?.category ?? "SONSTIGES"}
      />
      <SelectField
        name="propertyId"
        label={t("documents.property")}
        options={properties}
        leading={[{ value: "", label: t("documents.allProperties") }]}
        defaultValue={doc?.propertyId ?? ""}
      />
      <SelectField
        name="unitId"
        label={t("documents.unit")}
        options={units}
        leading={[{ value: "", label: t("common.none") }]}
        defaultValue={doc?.unitId ?? ""}
      />
      <SelectField
        name="personId"
        label={t("documents.person")}
        options={persons}
        leading={[{ value: "", label: t("common.none") }]}
        defaultValue={doc?.personId ?? ""}
      />
    </CrudDialog>
  );
}
