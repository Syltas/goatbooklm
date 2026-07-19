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
import { PdfUploadTab } from "./pdf-upload-tab"
import { TextSourceTab } from "./text-source-tab"
import { WebSourceTab } from "./web-source-tab"

interface AddSourceDialogProps {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (source: SourceWithChunkCount) => void
}

/**
 * 3-tab (PDF/Text/Web) add-source dialog (specs/02-ingestion.md §5 AC-1).
 * Text/Web get a full `Source` row back from their action and hand it to
 * `onCreated` for an immediate list update; PDF only ever gets
 * `{ sourceId, storagePath }` back (§9 contract) and instead just closes —
 * see `pdf-upload-tab.tsx`'s doc comment for why that's still correct.
 */
export function AddSourceDialog({
  notebookId,
  open,
  onOpenChange,
  onCreated,
}: AddSourceDialogProps) {
  const [tab, setTab] = useState("pdf")

  function handleCreated(source: SourceWithChunkCount) {
    onCreated(source)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-test="add-source-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quelle hinzufügen</DialogTitle>
          <DialogDescription>
            Füge ein PDF, eingefügten Text oder eine Web-Seite als neue
            Quelle zu diesem Notizbuch hinzu.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pdf" data-test="add-source-tab-pdf">
              PDF
            </TabsTrigger>
            <TabsTrigger value="text" data-test="add-source-tab-text">
              Text
            </TabsTrigger>
            <TabsTrigger value="web" data-test="add-source-tab-web">
              Web
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pdf">
            <PdfUploadTab
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
