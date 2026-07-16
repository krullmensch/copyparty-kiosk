// foliate-js liefert keine eigenen Typen (reines ESM ohne Build-Step).
// Minimale Ambient-Deklaration für die Teile, die DocumentViewer.tsx nutzt.
declare module 'foliate-js/view.js' {
  export class View extends HTMLElement {
    book: unknown
    renderer: unknown
    open(book: File | Blob | string): Promise<void>
    close(): void
    next(distance?: number): Promise<void>
    prev(distance?: number): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
  }
}
