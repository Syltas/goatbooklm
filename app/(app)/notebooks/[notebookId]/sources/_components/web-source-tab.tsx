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
import { AddWebSourceSchema } from "@/lib/ingestion/schema"

import { addWebSourceAction } from "../actions"
import type { SourceWithChunkCount } from "../types"

interface WebSourceTabProps {
  notebookId: string
  onCreated: (source: SourceWithChunkCount) => void
}

export function WebSourceTab({ notebookId, onCreated }: WebSourceTabProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(AddWebSourceSchema),
    defaultValues: { notebookId, url: "", title: "" },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const urlValue = form.watch("url")
  const canSubmit = urlValue.trim().length > 0 && !form.formState.errors.url

  function onSubmit(data: z.infer<typeof AddWebSourceSchema>) {
    setError(null)
    startTransition(async () => {
      const result = await addWebSourceAction(data)
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
          <Alert variant="destructive" data-test="web-source-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FormField
          name="url"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>URL</FormLabel>
              <FormControl>
                <Input
                  placeholder="https://example.com/artikel"
                  data-test="web-source-url-input"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="title"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Titel (optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="Wird automatisch übernommen, falls leer"
                  data-test="web-source-title-input"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={pending || !canSubmit}
            data-test="web-source-submit"
          >
            {pending ? "Wird hinzugefügt…" : "Hinzufügen"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
