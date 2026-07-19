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
    <div className="min-h-0 flex-1 overflow-y-auto" data-test="source-list">
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
