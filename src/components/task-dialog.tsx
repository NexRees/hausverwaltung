"use client";

// nexrees: create or edit a task, hand it to a colleague, optionally linked to a record.
import { useTranslations } from "next-intl";
import { CrudDialog } from "@/components/crud-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { saveTask } from "@/server/actions/collab";

export type TaskDialogTask = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null; // yyyy-mm-dd
  assigneeId: string | null;
};

export function TaskDialog({
  trigger,
  users,
  task,
  entity,
  entityId,
  defaultAssigneeId,
}: {
  trigger: React.ReactElement;
  users: { id: string; name: string }[];
  task?: TaskDialogTask;
  entity?: string;
  entityId?: string;
  defaultAssigneeId?: string;
}) {
  const t = useTranslations();
  return (
    <CrudDialog
      trigger={trigger}
      title={task ? t("collab.editTask") : t("collab.newTask")}
      action={saveTask}
      submitLabel={task ? t("common.save") : t("common.create")}
    >
      {task && <input type="hidden" name="id" value={task.id} />}
      {entity && entityId && (
        <>
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="entityId" value={entityId} />
        </>
      )}
      <TextField name="title" label={t("collab.taskTitle")} defaultValue={task?.title} />
      <SelectField
        name="assigneeId"
        label={t("collab.assignee")}
        leading={[{ value: "", label: t("collab.unassigned") }]}
        options={users.map((u) => ({ value: u.id, label: u.name }))}
        defaultValue={task ? (task.assigneeId ?? "") : (defaultAssigneeId ?? "")}
      />
      <TextField name="dueDate" label={t("collab.dueDate")} type="date" required={false} defaultValue={task?.dueDate ?? undefined} />
      <TextAreaField name="description" label={t("collab.description")} defaultValue={task?.description ?? undefined} rows={3} />
    </CrudDialog>
  );
}
