export interface LocalDragPayload {
  kind: 'local'
  paths: string[]
}

export interface RemoteDragPayload {
  kind: 'remote'
  server: string
  vpaths: string[]
  names: string[]
}

export type DragPayload = LocalDragPayload | RemoteDragPayload

export const DRAG_MIME = 'application/x-cpp-kiosk'
