# CLAUDE.md — copyparty-kiosk

Einstiegspunkt für neue Chats. Dies ist das **Kiosk-Frontend-Projekt** für Marvins Bachelor-Projekt. Das Backend (copyparty) lebt in einem separaten Repo.

## Projekt in einem Satz

Kiosk-Filemanager für Linux: Electron-App, die lokale USB-Sticks und externe Laufwerke nativ erkennt und in einem Split-Screen-UI parallel zu Remote-VFS-Volumes (via copyparty) anzeigt — Drag&Drop und Operationen funktionieren nahtlos zwischen beiden Welten.

## Wo was lebt

```
~/Documents/GitHub/
├── copyparty/                  ← Backend-Referenz, Upstream-Repo
│   ├── copyparty/              ← Python-Backend (NICHT anfassen)
│   ├── bin/u2c.py              ← up2k-Referenzclient (TS-Port-Vorlage)
│   ├── docs/up2k.txt           ← Protokoll-Spec
│   ├── docs-frontend/          ← komplette Recherche-Doku
│   │   ├── 01-overview.md      ← copyparty-Frontend heute
│   │   ├── 02-entrypoints.md   ← Templates + Jinja2-Vars
│   │   ├── 03-modules.md       ← was jede JS-Datei tut
│   │   ├── 04-backend-api.md   ← HTTP-API + up2k-Protokoll
│   │   ├── 05-state-and-features.md ← State/i18n/Theming
│   │   ├── 06-rewrite-feasibility.md ← Strategie + Aufwand
│   │   ├── 07-killer-features.md ← was bleibt, was geht
│   │   ├── 08-kiosk-usb-setup.md ← Architektur für DIESES Projekt
│   │   └── 09-electron-stack.md ← Toolchain, Pakete, Boilerplate
│   └── CLAUDE.md               ← Recherche-Kontext
│
└── copyparty-kiosk/            ← DU BIST HIER (das neue Kiosk-Frontend)
    ├── src/
    │   ├── main/               ← Electron Main-Process (Node.js)
    │   ├── preload/            ← contextBridge IPC
    │   └── renderer/           ← React-Frontend
    ├── electron.vite.config.ts
    ├── electron-builder.yml
    ├── package.json
    └── CLAUDE.md               ← diese Datei
```

**Beim Arbeiten hier:** wenn du Architektur-/Feature-/API-Fragen hast, schau in `../copyparty/docs-frontend/`. Wenn du copyparty-Quellcode brauchst (z.B. up2k-Logik portieren), liegt der in `../copyparty/copyparty/` und `../copyparty/bin/u2c.py`.

## Stack (gesetzt)

| Schicht | Tech |
|---|---|
| Boilerplate | `electron-vite` mit `react-ts`-Template |
| Frontend | React 18 + TypeScript |
| Build | Vite (über electron-vite) |
| Package-Manager | npm |
| Desktop-Wrapper | Electron 32+ |
| Server-State | TanStack Query |
| UI-Lib | shadcn/ui + Radix + Tailwind |
| USB-Detection | `drivelist` (Polling) → später optional `dbus-next` |
| Lokales FS | Node `fs/promises` + `fs-extra` |
| Upload | eigener up2k-TS-Client mit `hash-wasm` für SHA-512 |
| Remote-Backend | copyparty (separater Prozess, bleibt unverändert) |
| Distribution | electron-builder → AppImage + .deb |
| Kiosk-Mode | Electron `kiosk: true` + systemd-User-Service |
| USB-Auto-Mount | udev-Rule → `systemd-mount /media/<label>/` |

**Bewusst NICHT verwendet:** Bun (Vite-Integration zu unreif für Electron), Tauri (Time-to-Done-Argument), Yarn/pnpm (npm reicht).

## Architektur (Drei-Schicht-Hybrid)

```
Renderer (React, sandboxed)
   ↕ contextBridge IPC
Main-Process (Node.js, privileged)
   ↕ HTTP
copyparty (separater systemd-Service)
```

- **Renderer:** UI-Komponenten, kein direkter System-Zugriff
- **Main-Process:** USB-Watch, lokales FS, copyparty-HTTP-Client, Eject
- **copyparty:** Remote-VFS, Multi-User, up2k-Server

**Split-Screen UX:** linke Pane = lokal/USB, rechte Pane = Remote-Volume. Operationen-Router im Main-Process dispatched per Source-Type:

```ts
type Source =
  | { type: 'local'; path: string }
  | { type: 'usb'; deviceId: string; mountPoint: string; path: string }
  | { type: 'copyparty'; server: string; auth: AuthToken; vpath: string };

copy(src: Source, dst: Source, items: string[])  // 4-Wege-Routing
```

Details: `../copyparty/docs-frontend/08-kiosk-usb-setup.md`

## Killer-Features die mitkommen müssen (Priorität)

1. **up2k** — resumable, dedupliziert, kein Größenlimit (Hauptaufwand: ~1-2 Wochen)
2. **Race the Beam** — Download während Upload (kommt fast gratis mit up2k)
3. **Unpost** — eigene Uploads zurückholen
4. **Drag-Search** — Datei droppen, hashen, "kennst du die?"
5. **Incoming-Anzeige** — andere User-Uploads sichtbar
6. **Live-Tail wachsender Files**
7. **OS-Media-Controls** via MediaSession API
8. **Per-Volume-Permissions im UI respektieren**

Bewusst weggelassen: 22 Sprachen (start mit DE/EN), Equalizer/DRC, OPDS, CBZ, Markdown-Editor, 10 Themes.

Details: `../copyparty/docs-frontend/07-killer-features.md`

## Was schon da ist

- ✅ Electron-vite-Boilerplate mit React + TS
- ✅ ESLint + Prettier konfiguriert
- ✅ electron-builder konfiguriert für Win/Mac/Linux
- ✅ Git-Repo initialisiert

## Was als Nächstes ansteht

In dieser Reihenfolge (siehe `../copyparty/docs-frontend/08-kiosk-usb-setup.md` für den 12-Wochen-Plan):

1. **Wochen 1-2: Foundation**
   - Tailwind + shadcn/ui einrichten (`npx shadcn@latest init`)
   - Kiosk-Mode für BrowserWindow konfigurieren (im Build, nicht in Dev)
   - systemd-User-Service für Auto-Start

2. **Wochen 2-3: USB + lokales FS**
   - `drivelist`-Polling im Main-Process
   - IPC-Channel `drive:added` / `drive:removed`
   - Linker Pane: lokales FS-Listing mit `fs.readdir`

3. **Wochen 4-5: copyparty-Integration**
   - Login-Screen (POST `?login`, Cookie `cppwd`)
   - Rechte Pane: `?ls`-Response als Listing rendern
   - TanStack Query als Cache-Layer

4. **Wochen 5-6: Operationen-Router**
   - 4-Wege-Copy/Move/Delete-Logik
   - Drag&Drop zwischen Panes
   - Norton-Commander-Hotkeys (F5/F6/F8/F10)

5. **Wochen 7-9: up2k-Client**
   - Hashing-Worker (Web-Worker mit `hash-wasm`)
   - Handshake-State-Machine
   - Chunked Parallel Upload mit Resume
   - Subchunking für >96MB
   - Unpost-UI

6. **Wochen 10-11: Polish**
   - Thumbnails (lokal + remote)
   - Audio/Video-Preview mit MediaSession
   - Eject-Button via `udisksctl unmount`
   - Free-Space-Anzeige pro Drive

7. **Woche 12: Bachelor-Arbeit schreiben**

## Argumente für die Bachelor-Arbeit

In der Theorie-Section verteidigbar:

1. **Browser-Sandbox vs. Native-Privileg** — warum reines Web nicht reicht
2. **Drei-Schicht-Hybrid-Architektur** als Pattern für HW-Awareness
3. **Operationen-Routing** als Strategy-Pattern für heterogene I/O-Backends
4. **Resumable-Uploads in Hostile-Networks** — up2k vs. naive Multipart
5. **Capability-based Security via contextBridge + Sandbox-Mode**

## Konventionen / Stil

- **Antworten auf Deutsch** (Marvin fragt auf Deutsch)
- **Keine Doku ungebeten schreiben** — nur wenn explizit verlangt
- **Code-Kommentare nur wo nicht-offensichtlich**
- **Ehrliche Aufwandsschätzungen** statt Marketing-Optimismus
- **copyparty-Upstream nicht patchen** — alles im eigenen App-Layer lösen
- **Security-Defaults nicht weichkochen:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` bleiben gesetzt

## Wichtige Skills/MCPs in dieser Session

- `ui-ux-pro-max` — Design-Intelligence (67 Styles, 161 Palettes, shadcn-Integration)
- `graphify` — falls Codebase-Fragen kommen, `../copyparty/graphify-out/graph.json` ist verfügbar
- `claude-api` — falls API-Code mit Claude SDK gebaut wird (irrelevant für dieses Projekt)

## Re-Entry-Prompt für neue Chats

```
Lies CLAUDE.md hier und ../copyparty/docs-frontend/08-kiosk-usb-setup.md
sowie ../copyparty/docs-frontend/09-electron-stack.md.
Ich arbeite weiter an [konkretes Thema].
```

Damit hat der nächste Chat den vollen Kontext.
