import { useEffect } from 'react'
import { usePreview } from '../preview/PreviewProvider'

/** true wenn der Fokus in einem Textfeld liegt — dann keine globalen Preview-Shortcuts. */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return (el as HTMLElement).isContentEditable === true
}

/**
 * Globaler Keyboard-Wiring für Preview: Space = QuickLook-Toggle, Enter = Vollansicht,
 * Escape = schließen. Muss innerhalb eines PreviewProvider gemountet sein.
 */
export function usePreviewKeys(): void {
  const { mode, activeSelection, openQuickLook, openFullView, close } = usePreview()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Guard 1: Tippen in Login-Form / späterem Editor nicht kapern
      if (isEditableTarget(document.activeElement)) return

      if (e.key === 'Escape') {
        if (mode) {
          e.preventDefault()
          close()
        }
        return
      }

      if (e.key === 'Enter') {
        // Guard 2: nur ein Datei-Eintrag (kein Ordner) ist previewbar
        if (activeSelection && !activeSelection.isDirectory) {
          e.preventDefault()
          openFullView(activeSelection.name, activeSelection.size, activeSelection.source)
        }
        return
      }

      if (e.key === ' ' || e.code === 'Space') {
        if (mode === 'quicklook') {
          // QuickLook: Space schließt (Video-Tastatursteuerung ist dort aus).
          e.preventDefault()
          close()
          return
        }
        if (mode === 'fullview') {
          // Großer Player/Viewer: Space NICHT kapern — der fokussierte Viewer
          // (Video Play/Pause, Text-Editor Leerzeichen) bekommt es.
          return
        }
        // mode === null: QuickLook öffnen, nur bei genau einem Datei-Eintrag
        if (activeSelection && !activeSelection.isDirectory) {
          e.preventDefault() // Guard 3: Scroll nur unterdrücken, wenn konsumiert
          openQuickLook(activeSelection.name, activeSelection.size, activeSelection.source)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, activeSelection, openQuickLook, openFullView, close])
}
