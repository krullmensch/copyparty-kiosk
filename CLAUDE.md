# CLAUDE.md — copyparty-kiosk

Einstiegspunkt für neue Chats. Kiosk-Frontend-Projekt für Marvins Bachelor-Projekt. Backend (copyparty) lebt im separaten Repo nebenan.

**GitHub:** https://github.com/krullmensch/copyparty-kiosk (private)

## Projekt in einem Satz

Kiosk-Filemanager für Linux: Electron-App, erkennt lokale USB-Sticks und externe Laufwerke nativ, zeigt sie im Split-Screen-UI parallel zu Remote-VFS-Volumes (via copyparty). Drag&Drop und Operationen funktionieren nahtlos zwischen beiden Welten.

## Re-Entry-Prompt (für neue Chats kopieren)

```
Lies CLAUDE.md hier und README.md.
Companion-Docs in ../copyparty/docs-frontend/.
Ich arbeite weiter an [konkretes Thema].
```

## Wo was lebt

```
~/Documents/GitHub/
├── copyparty/                  ← Backend-Referenz, Upstream-Repo
│   ├── copyparty/              ← Python-Backend (NICHT anfassen)
│   ├── bin/u2c.py              ← up2k-Referenzclient (TS-Port-Vorlage)
│   ├── docs/up2k.txt           ← Protokoll-Spec
│   └── docs-frontend/          ← Recherche-Doku (01–09)
│
└── copyparty-kiosk/            ← DU BIST HIER
    ├── src/main/               ← Electron Main (Node.js)
    │   └── ipc/                ← drives.ts, fs.ts, copyparty.ts
    ├── src/preload/            ← contextBridge IPC
    ├── src/renderer/           ← React-Frontend
    │   └── src/
    │       ├── App.tsx
    │       ├── components/     ← Panes + RemoteLoginForm + ui/
    │       ├── hooks/          ← useDrives, useListing, useRemoteListing, useSelection
    │       └── lib/            ← format.ts, utils.ts (cn)
    ├── src/shared/             ← types.ts, dragdrop.ts (für main + renderer)
    ├── README.md               ← detaillierter Status + API-Surface
    └── CLAUDE.md               ← diese Datei
```

## Was funktioniert (Stand 2026-05-25)

- ✅ Electron 39 + React 19 + TS via electron-vite 5
- ✅ Tailwind v4 + shadcn/ui (new-york, neutral) — Button, Input, Label, ScrollArea, Sonner installiert
- ✅ USB/removable Detection (`drivelist`, 2s Polling, filtert nicht-USB/non-removable)
- ✅ Sidebar mit Home + Drive-Liste
- ✅ Lokale Pane (browse, ↑/parent, reload, hidden toggle, double-click navigate)
- ✅ Remote Pane (copyparty login, browse, vpath nav, disconnect)
- ✅ Cookie-Auth im Main-Process (`Map<server, cookieString>`)
- ✅ Drag/Drop zwischen Panes:
  - local→remote: multipart `act=bput` POST
  - remote→local: HTTP stream via `pipeline(Readable.fromWeb → createWriteStream)`
- ✅ Multi-Select (click single, shift-click range, cmd/ctrl-click toggle, clear on cwd change)
- ✅ Sonner Toasts (richColors, top-right)
- ✅ Dark Mode Toggle (`.dark` class on `<html>`)
- ✅ Typecheck grün

## Was noch fehlt (Roadmap, in Reihenfolge sinnvoll)

1. **up2k-Client** — ~1-2 Wochen (größter Brocken)
   - Web-Worker mit `hash-wasm` für SHA-512 pro Chunk
   - Handshake-State-Machine (POST JSON → fehlende Chunks zurück)
   - Chunked Parallel Upload mit `sprs`-Flag
   - Resume nach Disconnect
   - Subchunking für >96 MB (Cloudflare-Workaround)
   - Referenz: `../copyparty/bin/u2c.py` (~1700 Zeilen, gut lesbar)
   - Spec: `../copyparty/docs/up2k.txt` + `04-backend-api.md`

2. **Race the Beam** — kommt fast gratis mit up2k (Range-GET auf wachsender Datei)

3. **Unpost** — eigener Tab `🧯`, POST gegen Unpost-Endpoint (`-e2d` muss server-side an sein)

4. **Drag-Search** — Hashen lokal + Server fragen "kennst du?" statt Upload

5. **Directory Upload/Download** — rekursiv über `fs.readdir` + Loop

6. **Conflict Resolution** — overwrite/rename/skip Dialog vor Drop

7. **Progress UI** — pro Transfer, IPC `onProgress` Event-Stream vom Main

8. **Kiosk-Mode** — `BrowserWindow.kiosk: true` in Production-Build, nicht in Dev

9. **Norton-Hotkeys** — F5 copy, F6 move, F8 delete, F10 quit

10. **Eject Button** — `udisksctl unmount` via `child_process` im Main

11. **systemd-User-Service** + udev-Rule für USB-Auto-Mount (Deployment)

12. **MediaSession API** — OS-Media-Controls für Audio (Lock-Screen-Play/Pause)

13. **Live-Tail wachsender Files** — Range-Polling für `tail -f` im UI

## Stack (gesetzt)

| Schicht | Tech |
|---|---|
| Boilerplate | `electron-vite` v5 mit `react-ts`-Template |
| Frontend | React 19 + TypeScript 5.9 |
| Build | Vite 7 (über electron-vite) |
| Package-Manager | npm |
| Desktop-Wrapper | Electron 39 |
| Server-State | (noch nicht) — geplant TanStack Query |
| UI-Lib | shadcn/ui v4 (new-york) + Radix + Tailwind v4 |
| USB-Detection | `drivelist` (Polling 2s) |
| Lokales FS | Node `fs/promises` (nicht fs-extra, nicht nötig bisher) |
| HTTP-Client | nativer `fetch` im Main-Process |
| Upload | aktuell multipart, **up2k kommt noch** mit `hash-wasm` |
| Remote-Backend | copyparty (separater Prozess, unverändert) |
| Distribution | electron-builder → AppImage + .deb (konfiguriert, ungetestet) |
| Toasts | `sonner` |
| Icons | `lucide-react` |

**Bewusst NICHT verwendet:** Bun, Tauri, Yarn/pnpm, fs-extra (vorerst).

## Architektur

Drei-Schicht-Hybrid:

```
Renderer (React, sandboxed)
   ↕ contextBridge IPC
Main-Process (Node.js, privileged)
   ↕ HTTP
copyparty (separater systemd-Service)
```

**Operationen-Router** existiert noch nicht als formaler Modul — aktuell hat jede Pane direkte Drop-Handler die `cpp.upload` oder `cpp.download` aufrufen. Bei Erweiterung (lokal↔lokal Move, Remote↔Remote `?move`) lohnt sich Refactor zu zentralem Router in `src/main/router.ts`. Vorher unnötig.

## IPC-Surface (Stand heute)

```ts
api.drives.list(): DriveInfo[]
api.drives.onAdded(cb): unsubscribe
api.drives.onRemoved(cb): unsubscribe
api.fs.list(path): ListResult
api.fs.home(): string
api.cpp.connect(url, password?): ConnectResult
api.cpp.list(url, vpath): RemoteListResult
api.cpp.disconnect(url): void
api.cpp.connections(): string[]
api.cpp.upload(url, targetVpath, localPaths): TransferResult
api.cpp.download(url, targetDir, items): TransferResult
```

Drag-Payload (Custom MIME `application/x-cpp-kiosk`):

```ts
{ kind: 'local',  paths: string[] }
{ kind: 'remote', server: string, vpaths: string[], names: string[] }
```

## copyparty-Endpoints aktuell benutzt

- `POST /?login` form-urlencoded `cppwd=PW` — Cookie zurück
- `GET <vpath>/?ls` — JSON `{ dirs, files, acct, perms, srvinf }`
- `POST <vpath>/` multipart `act=bput`, Field `f` — single-file upload
- `GET <vpath>` — Datei-Stream (Cookie-Header)

**Noch nicht:** up2k-Handshake (`POST <vpath>/` JSON), Chunk-Upload mit `X-Up2k-Hash`/`X-Up2k-Wark`, `?delete`/`?move`/`?mk=dir`, `?th=w` Thumbnails, `?srch` Search, `?ru` Recent Uploads.

## Bachelor-Arbeit-Argumente

In der Theorie-Section verteidigbar:

1. **Browser-Sandbox vs. Native-Privileg** — warum reines Web nicht reicht
2. **Drei-Schicht-Hybrid** als Pattern für HW-Awareness
3. **Operationen-Routing** als Strategy-Pattern für heterogene I/O-Backends
4. **Resumable-Uploads in Hostile-Networks** — up2k vs. naive Multipart
5. **Capability-based Security via contextBridge + Sandbox-Mode**

## Konventionen / Stil

- **Antworten auf Deutsch** (Marvin fragt auf Deutsch)
- **Keine Doku ungebeten** — nur wenn explizit verlangt
- **Code-Kommentare nur wo nicht-offensichtlich**
- **Ehrliche Aufwandsschätzungen**, kein Marketing-Optimismus
- **copyparty-Upstream nicht patchen** — alles im App-Layer lösen
- **Security-Defaults nicht weichkochen:** `contextIsolation: true` bleibt. `sandbox: false` aktuell wegen drivelist (nativ); ggf. später trennen.
- **Caveman-Mode aktiv** in dieser Session — kann mit `stop caveman` deaktiviert werden

## Wichtige externe Files

- `../copyparty/bin/u2c.py` — kanonischer up2k-Client (~1700 Zeilen Python, gut lesbar)
- `../copyparty/docs/up2k.txt` — Protokoll-Spec
- `../copyparty/copyparty/httpcli.py` — HTTP-API (groß, ~7800 Zeilen)
- `../copyparty/docs-frontend/04-backend-api.md` — API-Cheatsheet
- `../copyparty/docs-frontend/07-killer-features.md` — Feature-Priorität
- `../copyparty/docs-frontend/08-kiosk-usb-setup.md` — Original-Architektur-Doku
- `../copyparty/docs-frontend/09-electron-stack.md` — Stack-Rationale

## Wichtige Skills/MCPs

- `ui-ux-pro-max` — Design-Intelligence (Plugin Manager installiert)
- `graphify` — falls Codebase-Fragen, `../copyparty/graphify-out/graph.json` da

## Setup für neuen Rechner

```bash
git clone https://github.com/krullmensch/copyparty-kiosk
cd copyparty-kiosk
npm install
npm run dev
```

copyparty muss separat laufen (z.B. `python -m copyparty` auf `:3923`).

## Aktueller Stand am [HEUTE]

Letzter Commit: `d393815` — initiales Scaffold mit allen oben markierten ✅ Features.

Nächster sinnvoller Schritt: **up2k-Client portieren**. Brauchst dafür `hash-wasm` als npm-Dep, einen Web-Worker für Hashing, und Lesen von `bin/u2c.py` als Vorlage.
