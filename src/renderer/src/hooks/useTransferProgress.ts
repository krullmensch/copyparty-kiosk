import { useEffect, useState } from 'react'
import type { UploadProgress, DownloadProgress } from '../../../shared/types'

export interface TransferState {
  bytesDone: number
  bytesTotal: number
  status: 'active' | 'done' | 'error'
}

export function useTransferProgress() {
  const [transfers, setTransfers] = useState<Record<string, TransferState>>({})

  useEffect(() => {
    const unsubUp = window.api.cpp.onProgress((p: UploadProgress) => {
      if (p.kind === 'hash' || p.kind === 'upload') {
        setTransfers(prev => ({
          ...prev,
          [p.name]: { bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, status: 'active' }
        }))
      } else if (p.kind === 'done' || p.kind === 'error') {
        setTransfers(prev => ({
          ...prev,
          [p.name]: { ...(prev[p.name] || { bytesDone: 0, bytesTotal: 0 }), status: p.kind }
        }))
        setTimeout(() => {
          setTransfers(prev => {
            if (prev[p.name]?.status === p.kind) {
              const next = { ...prev }
              delete next[p.name]
              return next
            }
            return prev
          })
        }, 1000)
      }
    })

    const unsubDown = window.api.cpp.onDownloadProgress((p: DownloadProgress) => {
      if (p.kind === 'download') {
        setTransfers(prev => ({
          ...prev,
          [p.name]: { bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, status: 'active' }
        }))
      } else if (p.kind === 'done' || p.kind === 'error') {
        setTransfers(prev => ({
          ...prev,
          [p.name]: { ...(prev[p.name] || { bytesDone: 0, bytesTotal: 0 }), status: p.kind }
        }))
        setTimeout(() => {
          setTransfers(prev => {
            if (prev[p.name]?.status === p.kind) {
              const next = { ...prev }
              delete next[p.name]
              return next
            }
            return prev
          })
        }, 1000)
      }
    })

    return () => {
      unsubUp()
      unsubDown()
    }
  }, [])

  return transfers
}
