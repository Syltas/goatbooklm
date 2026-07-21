"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import type { SourceWithChunkCount } from "../types"
import { FileUploadTab } from "./file-upload-tab"
import { TextSourceTab } from "./text-source-tab"
import { WebSourceTab } from "./web-source-tab"

interface AddSourceDialogProps {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (source: SourceWithChunkCount) => void
}

/**
 * 3-tab (Datei/Text/Web) add-source dialog (specs/02-ingestion.md §5 AC-1).
 * Text/Web get a full `Source` row back from their action and hand it to
 * `onCreated` for an immediate list update; the file tab only ever gets
 * `{ sourceId, storagePath }` back (§9 contract) and instead just closes —
 * see `file-upload-tab.tsx`'s doc comment for why that's still correct.
 *
 * The first tab covers every uploadable format (PDF, Word, Excel, CSV,
 * text, Markdown, images), not just PDF — hence "Datei" rather than a
 * per-format tab, which would not scale past two or three formats.
 */
export function AddSourceDialog({
  notebookId,
  open,
  onOpenChange,
  onCreated,
}: AddSourceDialogProps) {
  const [tab, setTab] = useState("file")

  function handleCreated(source: SourceWithChunkCount) {
    onCreated(source)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-test="add-source-dialog"
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Quelle hinzufügen</DialogTitle>
          <DialogDescription>
            Füge eine Datei (PDF, Word, Excel, CSV, Text, Markdown oder
            Bild), eingefügten Text oder eine Web-Seite als neue Quelle zu
            diesem Notizbuch hinzu.
          </DialogDescription>
        </DialogHeader>

        {/* Bug fix: with many files selected, the file list below used to
         * grow without bound and push this dialog's header/buttons off the
         * top and bottom of the viewport. This wrapper caps the dialog at
         * 85dvh (DialogContent, above) and turns everything below the fixed
         * header into one scrollable region, so the header stays put and
         * the tab body scrolls instead of the whole dialog growing past the
         * viewport. See file-upload-tab.tsx for the matching fix that also
         * caps the file list's own height. */}
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="file" data-test="add-source-tab-file">
              Datei
            </TabsTrigger>
            <TabsTrigger value="text" data-test="add-source-tab-text">
              Text
            </TabsTrigger>
            <TabsTrigger value="web" data-test="add-source-tab-web">
              Web
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file">
            <FileUploadTab
              notebookId={notebookId}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>
          <TabsContent value="text">
            <TextSourceTab notebookId={notebookId} onCreated={handleCreated} />
          </TabsContent>
          <TabsContent value="web">
            <WebSourceTab notebookId={notebookId} onCreated={handleCreated} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
