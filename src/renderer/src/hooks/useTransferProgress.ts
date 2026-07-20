import { useEffect, useState } from 'react'
import type { UploadProgress, DownloadProgress } from '../../../shared/types'

export interface TransferState {
  bytesDone: number
  bytesTotal: number
}

export function useTransferProgress() {
  const [transfers, setTransfers] = useState<Record<string, TransferState>>({})

  useEffect(() => {
    const unsubUp = window.api.cpp.onProgress((p: UploadProgress) => {
      if (p.kind === 'hash' || p.kind === 'upload') {
        setTransfers(prev => ({
          ...prev,
          [p.name]: { bytesDone: p.bytesDone, bytesTotal: p.bytesTotal }
        }))
      } else if (p.kind === 'done' || p.kind === 'error') {
        setTransfers(prev => {
          const next = { ...prev }
          delete next[p.name]
          return next
        })
      }
    })

    const unsubDown = window.api.cpp.onDownloadProgress((p: DownloadProgress) => {
      if (p.kind === 'download') {
        setTransfers(prev => ({
          ...prev,
          [p.name]: { bytesDone: p.bytesDone, bytesTotal: p.bytesTotal }
        }))
      } else if (p.kind === 'done' || p.kind === 'error') {
        setTransfers(prev => {
          const next = { ...prev }
          delete next[p.name]
          return next
        })
      }
    })

    return () => {
      unsubUp()
      unsubDown()
    }
  }, [])

  return transfers
}
