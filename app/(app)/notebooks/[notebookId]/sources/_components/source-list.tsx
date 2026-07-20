"use client"

import type { SourceWithChunkCount } from "../types"
import { SourceListItem } from "./source-list-item"

interface SourceListProps {
  sources: SourceWithChunkCount[]
  onOpen: (source: SourceWithChunkCount) => void
  onDeleteRequest: (source: SourceWithChunkCount) => void
}

export function SourceList({ sources, onOpen, onDeleteRequest }: SourceListProps) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
      data-test="source-list"
    >
      {sources.map((source) => (
        <SourceListItem
          key={source.id}
          source={source}
          onOpen={() => onOpen(source)}
          onDeleteRequest={() => onDeleteRequest(source)}
        />
      ))}
    </div>
  )
}
