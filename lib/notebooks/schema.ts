import { z } from "zod"

export const CreateNotebookSchema = z.object({
  title: z
    .string()
    .min(1, "Titel ist erforderlich")
    .max(255, "Titel darf höchstens 255 Zeichen lang sein"),
  description: z
    .string()
    .max(2000, "Beschreibung darf höchstens 2000 Zeichen lang sein")
    .optional(),
})

export const UpdateNotebookSchema = CreateNotebookSchema.extend({
  id: z.uuid("Ungültige Notizbuch-ID"),
})

export const DeleteNotebookSchema = z.object({
  id: z.uuid("Ungültige Notizbuch-ID"),
})

export type CreateNotebookInput = z.infer<typeof CreateNotebookSchema>
export type UpdateNotebookInput = z.infer<typeof UpdateNotebookSchema>
export type DeleteNotebookInput = z.infer<typeof DeleteNotebookSchema>
