"use client"

import { MoreVertical, Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { DeleteChatHistoryDialog } from "./delete-chat-history-dialog"

interface ChatHeaderMenuProps {
  notebookId: string
  /** No history yet ⇒ nothing to delete, so the menu item is disabled
   *  rather than opening a dialog that would delete zero rows. */
  hasHistory: boolean
  onHistoryDeleted: () => void
}

/**
 * The kebab menu in the Chat panel header. Kept in the shell (not inside
 * `ChatPanel`) because the header belongs to `DesktopPanel` — the deletion is
 * therefore reported back up via `onHistoryDeleted`, which the shell forwards
 * to `ChatPanel` so its `useChat` transcript is cleared in the same tick.
 */
export function ChatHeaderMenu({
  notebookId,
  hasHistory,
  onHistoryDeleted,
}: ChatHeaderMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-test="chat-header-menu"
            aria-label="Chat-Optionen"
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        {/* Wide enough that "Chatverlauf löschen" stays on one line. */}
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            variant="destructive"
            disabled={!hasHistory}
            data-test="chat-header-menu-delete-history"
            onSelect={() => setConfirmOpen(true)}
          >
            <Trash2 /> Chatverlauf löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteChatHistoryDialog
        notebookId={notebookId}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onDeleted={onHistoryDeleted}
      />
    </>
  )
}
