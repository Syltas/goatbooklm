"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import type { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { AddTextSourceSchema } from "@/lib/ingestion/schema"
import { cn } from "@/lib/utils"

import { addTextSourceAction } from "../actions"
import type { SourceWithChunkCount } from "../types"

const MAX_TEXT_LENGTH = 500_000

interface TextSourceTabProps {
  notebookId: string
  onCreated: (source: SourceWithChunkCount) => void
}

export function TextSourceTab({ notebookId, onCreated }: TextSourceTabProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(AddTextSourceSchema),
    defaultValues: { notebookId, title: "", text: "" },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const titleValue = form.watch("title")
  const textValue = form.watch("text")
  const overLimit = textValue.length > MAX_TEXT_LENGTH
  const canSubmit =
    titleValue.trim().length > 0 && textValue.trim().length > 0 && !overLimit

  function onSubmit(data: z.infer<typeof AddTextSourceSchema>) {
    setError(null)
    startTransition(async () => {
      const result = await addTextSourceAction(data)
      if ("error" in result) {
        setError(result.error)
        return
      }
      onCreated(result.data as SourceWithChunkCount)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
        {error && (
          <Alert variant="destructive" data-test="text-source-error">
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
                  placeholder="z. B. Meeting-Notizen"
                  data-test="text-source-title-input"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="text"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Text</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Füge hier deinen Text ein…"
                  className="min-h-40"
                  data-test="text-source-textarea"
                  {...field}
                />
              </FormControl>
              <p
                className={cn(
                  "text-xs",
                  overLimit ? "text-destructive" : "text-muted-foreground"
                )}
                data-test="text-source-char-count"
              >
                {textValue.length.toLocaleString("de-DE")} /{" "}
                {MAX_TEXT_LENGTH.toLocaleString("de-DE")} Zeichen
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={pending || !canSubmit}
            data-test="text-source-submit"
          >
            {pending ? "Wird hinzugefügt…" : "Hinzufügen"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
