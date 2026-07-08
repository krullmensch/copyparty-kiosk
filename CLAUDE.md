# CLAUDE.md — copyparty-kiosk

Einstiegspunkt für neue Chats. Kiosk-Frontend-Projekt für Marvins Bachelor-Projekt. Backend (copyparty) lebt im separaten Repo nebenan.

**GitHub:** https://github.com/krullmensch/copyparty-kiosk (private)

## 🤖 AI Workflow: 10-80-10 Tiered Agent Orchestration

Dieses Projekt nutzt einen Tiered Agent Workflow zur Token-Optimierung. Die Zusammenarbeit wird zentral über die Datei `RUN-STATE.md` im Root-Verzeichnis gesteuert.

### Rollen & Masterprompts (System Instructions)

**1. Architect (Fable 5)**
> Du bist der Lead Architect. Deine Aufgabe ist es, das Problem zu analysieren, die Architektur zu planen und das Projekt in unabhängige Sub-Tasks zu zerlegen. Schreibe KEINEN Code. Erstelle für jeden Sub-Task ein "Handoff-Package" mit einer klaren "Definition of Ready" und aktualisiere die `RUN-STATE.md`. Delegiere die Implementierung.

**2. Developer (Opus 4.8 / Sonnet 5)**
> Du bist der Developer. Implementiere strikt das übergebene Handoff-Package des Architects aus der `RUN-STATE.md`. Baue keine Features, Abstraktionen oder Fehlerbehandlungen ein, die nicht explizit in der Spezifikation gefordert wurden. Das System funktioniert als komplett isoliertes Sneakernet ohne Internetanbindung – füge niemals Abhängigkeiten zu externen Webdiensten, CDNs oder Cloud-APIs hinzu. Nutze die einfachste lokale Lösung, die funktioniert. Wenn du fertig bist, aktualisiere deinen Status in der `RUN-STATE.md`.

**3. Test-Writer (Haiku 4.5 / Sonnet 5)**
> Du bist der Test-Writer. Schreibe Tests für die bereitgestellten Module, die genau die in der Spezifikation definierten Assertions abdecken. Erfinde keine hypothetischen Edge-Cases, die nicht im Handoff-Package stehen. Dokumentiere den Abschluss in der `RUN-STATE.md`.

**4. Reviewer (Fable 5)**
> Du bist der finale Reviewer. Prüfe den generierten Code und die Diff-Logs der Developer-Agents gegen die ursprüngliche Spezifikation in der `RUN-STATE.md`. Evaluiere, ob die "Definition of Ready" erfüllt ist. Antworte ausschließlich mit einem strukturierten Urteil (Pass/Fail) und aktualisiere die Handoff Notes in der `RUN-STATE.md`. Schreibe den Code nicht selbst neu.

## Re-Entry-Prompt (für neue Chats kopieren)

```text
Lies CLAUDE.md hier und README.md.
Lies zwingend die RUN-STATE.md, um deinen aktuellen Status und deine Rolle (Architect, Developer, Test-Writer, Reviewer) zu erfassen.
Companion-Docs in ../copyparty/docs-frontend/.
Ich arbeite weiter an [konkretes Thema].
```

## Wo was lebt

```text
~/Documents/
├── copyparty/                  ← Backend-Referenz, Upstream-Repo
│   ├── copyparty/              ← Python-Backend (NICHT anfassen)
│   ├── bin/u2c.py              ← up2k-Referenzclient (TS-Port-Vorlage)
│   ├── docs/up2k.txt           ← Protokoll-Spec
│   └── docs-frontend/          ← Recherche-Doku (01–09)
│
└── copyparty-kiosk/            ← DU BIST HIER
    ├── RUN-STATE.md            ← AI Workflow State & Handoffs
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

## Was funktioniert (Stand 2026-06-26)

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
- ✅ **up2k-Client** (`src/main/up2k.ts`) — sha512[:33]-Chunk-Hashing, Handshake-State-Machine, Chunk-Upload mit Subchunking >96 MB, Resume via Re-Handshake. Sequenziell (1 Connection). End-to-end getestet gegen echten copyparty.
- ✅ **up2k Hostile-Network-Hardening** — Per-Request-Timeout (`AbortSignal.timeout`), Auto-Retry mit Backoff, geteilte Deadline ab letztem Erfolg, Fehler-Klassifikation (401/403/4xx fatal, 5xx/Netzwerk retry), Chunk-400 "already got that" = Erfolg. `retry`-Progress → Toast "Reconnecting…"
- ✅ Upload-Progress-UI (gooey-toast, `useUploadProgress.ts`: hash/upload/retry/done/error)
- ✅ Typecheck grün

## Was noch fehlt (Roadmap, in Reihenfolge sinnvoll)

1. ~~**up2k-Client**~~ ✅ **ERLEDIGT** (siehe oben "Was funktioniert"). Im Main-Process (Node `crypto`/`fs`), nicht Web-Worker — kein `hash-wasm` nötig. Offen nur noch (optional, reine Speed): **parallele Connections** (`-j`) + **Chunk-Join** (mehrere Chunks/POST, `cid0,n,prefix…`-Format wie u2c.py). Tragen keine These, nur Durchsatz.
   - Referenz: `../copyparty/bin/u2c.py` (~1700 Zeilen, gut lesbar)
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

## Agora-Integration (Bachelor-Werk)

Kiosk-App läuft auf drei Thinclients an einem schwarzen runden Sneakernet-Tisch („Agora"). **FritzBox 7490** spannt geschlossenes WLAN ohne Internet-Uplink (WAN-Kabel ungesteckt; DSL-Router läuft trotzdem als WLAN+DHCP weiter, Subnetz `192.168.178.0/24`). Drahtlose Übertragung in Anwesenheit = vollwertige Sneakernet-Form (Differenz zu Café-WLAN ist die fehlende Internetanbindung).

> **Router-Wechsel (2026-06-26):** vorher MikroTik hAP ac2 (`/rest`-API, Subnetz `192.168.88.x`). Jetzt FritzBox 7490. Kioske bereits unter `192.168.178.{61,63,59}`. Client-Tracking-Datenquelle dadurch getauscht (REST → TR-064), Poller-Logik bleibt.

**Vault-Referenz:** `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Bachelor/Agora/Technik/MikroTik-Client-Tracking.md` (⚠️ Doku noch auf MikroTik, FritzBox-Update offen)

### Agora-Dashboard (geplant, auf Kiosk2)

Zusätzlicher Dienst neben Electron-Kiosk, läuft NUR auf Kiosk2 (meiste RAM/Speicher der drei). Prototyp: `agora-dashboard/`.

- Python-Poller fragt **FritzBox TR-064** (Port 49000, SOAP) via `fritzconnection`-Lib alle 60 s ab — `FritzHosts.get_hosts_info()` → MAC/IP/active/hostname/interface
  - Voraussetzung: TR-064 in FritzBox an (Heimnetz → Netzwerk → Netzwerkeinstellungen → „Zugriff für Anwendungen zulassen"), FritzBox-User + PW
  - **Bytes-Caveat:** TR-064 liefert nur WLAN-**Aggregat** (`FritzWLAN`/Interface-Statistik), nicht pro Client (MikroTik konnte per-Client). „Bytes seit Session-Start" wird Summe statt pro-Gerät.
- SQLite unter `~/.agora/agora.db`, reboot-fest
- Flask/FastAPI auf `localhost:8080/dashboard`, andere Kioske ziehen über `http://kiosk2.local:8080/dashboard`
- Anzeigewerte: live-Clients, jemals-verbunden, übertragene Bytes seit Session-Start
- Reset nur via CLI `agora-reset` (neue session-row, samples + seen_macs DROP)
- MAC nur als SHA256(mac + session_salt) persistiert (DSGVO: MAC = personenbezogen nach Breyer 2016)

### Screensaver-Modus (in Electron integriert)

- Main-Process trackt Idle via `powerMonitor.getSystemIdleTime()` (plattformnativ, Wayland/X11 egal)
- Trigger: >20 s Idle ODER manueller Button in der Kiosk-Topbar (IPC `screensaver:show`)
- Kein Max-Timer — aktive Nutzung blockt den Screensaver dauerhaft
- Bei Trigger: zweites `BrowserWindow` `fullscreen + alwaysOnTop + frame: false + transparent: true`, lädt Renderer-Route `/screensaver`
- Mausbewegung → Main sendet `screensaver:fade-out` → Container fadet `opacity` per Tailwind `transition-opacity duration-300`, Main schließt nach 400 ms
- Renderer-Route fetcht `http://kiosk2.local:8080/stats` alle 5 s
- Versetzte Anzeigen auf den drei Stationen (kein Sync) = drei Beobachterperspektiven auf dasselbe Netz
- Theme/Fonts/Components geteilt mit Kiosk-App (shadcn, Tailwind)
- Single Point of Failure: Kiosk2 down → keine Stats-Daten. Aktuell akzeptiert.

### Roadmap-Reihenfolge (Agora)

1. ~~up2k-Client~~ ✅ fertig + hostile-network-gehärtet
2. **← HIER:** Agora-Dashboard-Service als separater Python-Prozess auf Kiosk2 (FritzBox-TR-064-Poller + Flask/FastAPI). Prototyp in `agora-dashboard/`.
3. Screensaver-Route + `powerMonitor`-Logik in Kiosk-App integrieren

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

```text
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
git clone [https://github.com/krullmensch/copyparty-kiosk](https://github.com/krullmensch/copyparty-kiosk)
cd copyparty-kiosk
npm install
npm run dev
```

copyparty muss separat laufen (z.B. `python -m copyparty` auf `:3923`).

## Aktueller Stand am 2026-06-26

up2k-Client fertig + hostile-network-gehärtet (Retry/Backoff/Resume), end-to-end gegen echten copyparty (kiosk2 `.61:3923`) getestet. Router von MikroTik auf FritzBox 7490 gewechselt — Agora-Client-Tracking nutzt jetzt TR-064 statt MikroTik-REST.

Nächster sinnvoller Schritt: **Agora-Dashboard** — FritzBox-TR-064-Poller (`agora-dashboard/`, `fritzconnection`-Lib) + Flask/FastAPI auf Kiosk2. Danach Screensaver-Route.