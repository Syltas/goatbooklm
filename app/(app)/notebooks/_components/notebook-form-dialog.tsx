"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { createNotebookAction, updateNotebookAction } from "../actions"
import { CreateNotebookSchema, UpdateNotebookSchema } from "@/lib/notebooks/schema"
import type { Notebook } from "@/lib/notebooks/service"

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Etwas ist schiefgelaufen. Bitte versuche es erneut."
}

interface NotebookFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  notebook?: Notebook | null
  onSaved: (notebook: Notebook) => void
}

/**
 * One dialog, two bodies. `mode`/`notebook` select which body renders; since
 * Radix unmounts `DialogContent`'s children while closed, each re-open
 * mounts a fresh form with fresh `defaultValues` — no manual reset-on-open
 * effect needed (AC-14, AC-21: "derselbe Dialog" for create and edit).
 */
export function NotebookFormDialog({
  open,
  onOpenChange,
  mode,
  notebook,
  onSaved,
}: NotebookFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-test="notebook-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Neues Notizbuch erstellen" : "Notizbuch bearbeiten"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Gib deinem Notizbuch einen Titel und optional eine Beschreibung."
              : "Ändere Titel oder Beschreibung dieses Notizbuchs."}
          </DialogDescription>
        </DialogHeader>

        {mode === "edit" && notebook ? (
          <EditNotebookFormBody
            notebook={notebook}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        ) : (
          <CreateNotebookFormBody onOpenChange={onOpenChange} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateNotebookFormBody({
  onOpenChange,
  onSaved,
}: {
  onOpenChange: (open: boolean) => void
  onSaved: (notebook: Notebook) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(CreateNotebookSchema),
    defaultValues: { title: "", description: "" },
  })

  const onSubmit = (data: z.infer<typeof CreateNotebookSchema>) => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await createNotebookAction(data)
        if ("error" in result) {
          setError(result.error)
          return
        }
        toast.success("Notizbuch erstellt")
        onOpenChange(false)
        onSaved(result.data)
      } catch (e) {
        setError(getErrorMessage(e))
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <Alert variant="destructive" data-test="notebook-form-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FormField
          name="title"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Titel</FormLabel>
              <FormControl>
                <Input
                  placeholder="z. B. Marketing-Strategie Q3"
                  data-test="notebook-form-title-input"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="description"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Beschreibung (optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Worum geht es in diesem Notizbuch?"
                  data-test="notebook-form-description-input"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" data-test="notebook-form-cancel-button">
              Abbrechen
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending} data-test="notebook-form-submit-button">
            {pending ? "Wird erstellt…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

function EditNotebookFormBody({
  notebook,
  onOpenChange,
  onSaved,
}: {
  notebook: Notebook
  onOpenChange: (open: boolean) => void
  onSaved: (notebook: Notebook) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(UpdateNotebookSchema),
    defaultValues: {
      id: notebook.id,
      title: notebook.title,
      description: notebook.description ?? "",
    },
  })

  const onSubmit = (data: z.infer<typeof UpdateNotebookSchema>) => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await updateNotebookAction(data)
        if ("error" in result) {
          setError(result.error)
          return
        }
        toast.success("Notizbuch aktualisiert")
        onOpenChange(false)
        onSaved(result.data)
      } catch (e) {
        setError(getErrorMessage(e))
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <Alert variant="destructive" data-test="notebook-form-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FormField
          name="title"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Titel</FormLabel>
              <FormControl>
                <Input data-test="notebook-form-title-input" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="description"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Beschreibung (optional)</FormLabel>
              <FormControl>
                <Textarea data-test="notebook-form-description-input" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" data-test="notebook-form-cancel-button">
              Abbrechen
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending} data-test="notebook-form-submit-button">
            {pending ? "Wird gespeichert…" : "Speichern"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
