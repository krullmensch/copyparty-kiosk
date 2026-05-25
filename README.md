# copyparty-kiosk

Linux kiosk filemanager. Electron + React. Shows local USB drives and remote [copyparty](https://github.com/9001/copyparty) volumes side-by-side. Drag/drop between panes to move files between local and remote.

Bachelor project. WIP.

## Status

### Works

- USB / removable drive detection (drivelist polling, 2s, USB+removable only)
- Local FS pane (browse, navigate, hidden toggle, reload)
- Remote copyparty pane (login, browse, navigate)
- Split-screen layout: local left, remote right
- Drag/drop between panes
  - local → remote: multipart upload (`act=bput`)
  - remote → local: HTTP stream download
- Multi-select (shift-click range, cmd/ctrl-click toggle)
- Toast notifications (sonner)
- Dark mode toggle
- Tailwind v4 + shadcn/ui (new-york + neutral)

### Not yet

- up2k protocol (resumable, dedup, large files) — currently plain multipart
- Directory upload/download (files only)
- Progress UI per transfer
- Conflict resolution (overwrite/rename/skip)
- Kiosk mode (`BrowserWindow.kiosk: true`)
- Auto-start via systemd-Unit
- udev rule for USB auto-mount
- Hotkeys (F5 copy / F6 move / F8 delete)
- Eject button (`udisksctl unmount`)
- copyparty killer features beyond core transfer (race-the-beam, unpost, live-tail, …)

## Architecture

Three-layer hybrid:

```
Renderer (React, sandboxed)
   ↕ contextBridge IPC
Main-Process (Node.js, privileged)
   ↕ HTTP
copyparty (separate systemd service)
```

- **Renderer**: React UI, no system access
- **Main**: drivelist (USB), `fs/promises` (local FS), `fetch` (copyparty HTTP), cookie jar
- **copyparty**: untouched upstream, runs as service

### Directory layout

```
src/
├── main/                       Electron main process
│   ├── index.ts                window + IPC registration
│   └── ipc/
│       ├── drives.ts           drivelist polling + add/remove events
│       ├── fs.ts               local FS list + home
│       └── copyparty.ts        HTTP client: connect/list/upload/download
├── preload/
│   ├── index.ts                contextBridge → window.api
│   └── index.d.ts              typed AppApi
├── renderer/src/
│   ├── App.tsx                 split-screen layout + sidebar
│   ├── components/
│   │   ├── FileBrowserPane.tsx     local pane
│   │   ├── RemoteBrowserPane.tsx   copyparty pane
│   │   ├── RemoteLoginForm.tsx     URL+password form
│   │   └── ui/                     shadcn components
│   ├── hooks/
│   │   ├── useDrives.ts            USB events → state
│   │   ├── useListing.ts           local FS reactive
│   │   ├── useRemoteListing.ts     remote reactive
│   │   └── useSelection.ts         range/toggle/single select
│   └── lib/
│       ├── format.ts               size/date formatters
│       └── utils.ts                cn() for Tailwind
└── shared/
    ├── types.ts                shared interfaces + IPC channel constants
    └── dragdrop.ts             drag payload schema + MIME
```

## copyparty integration

All over HTTP. No special protocol (yet). Multipart for upload, range-capable GET for download.

### Auth

- Cookie `cppwd` per server. Stored in `Map<serverUrl, cookieString>` inside main process.
- Login: `POST <server>/?login` with `Content-Type: application/x-www-form-urlencoded`, body `cppwd=<password>`. `Set-Cookie` captured and reused.
- Anonymous: skip login, probe `?ls`.
- Bad password returns 200 too, so post-login probe verifies success via `?ls`.

### Listing

- `GET <server><vpath>/?ls` with `Accept: application/json` and `Cookie`.
- Response JSON: `{ dirs: [...], files: [...], acct, perms, srvinf }`.
- Each entry: `{ href, name?, sz, ts, tags? }`. `name` derived from `href` when missing.
- Renderer keeps `vpath` state, builds child paths via `href`, navigates with double-click.

### Upload (multipart, no up2k yet)

- `POST <server><vpath>/` multipart form-data
- Fields: `act=bput`, `f=<file>` (one File per upload, sent sequentially per drop)
- File read via `createReadStream` → Web stream → Blob → File (Node FormData)
- Large files buffer fully in main `fetch`. Acceptable for v0; up2k will replace.

### Download

- `GET <server><vpath>` with Cookie
- Response body streamed via `Readable.fromWeb` + `pipeline` to `createWriteStream(target)`
- Plain HTTP, supports `Range` if needed later

### IPC surface

`window.api` (exposed via contextBridge):

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

### Drag/drop payload

Custom MIME `application/x-cpp-kiosk`, JSON:

```ts
{ kind: 'local',  paths: string[] }
{ kind: 'remote', server: string, vpaths: string[], names: string[] }
```

Both panes are drop targets. Source pane sets dropEffect to `copy`. Each pane decides based on `payload.kind` whether to dispatch upload or download.

## Stack

- Electron 39, Vite 7 via `electron-vite` 5
- React 19, TypeScript 5
- Tailwind v4 with `@tailwindcss/vite`
- shadcn/ui v4 (new-york style, neutral base, RSC off)
- drivelist (native, postinstall via electron-builder)
- sonner (toasts)
- lucide-react (icons)

## Development

```bash
npm install
npm run dev          # start with HMR
npm run typecheck    # tsc --noEmit (node + web)
npm run lint
npm run format
```

### Build (later, for deployment)

```bash
npm run build:linux  # AppImage + .deb via electron-builder
```

## Context

Companion docs in `../copyparty/docs-frontend/`:

- `01-overview.md` … `05-state-and-features.md` — analysis of copyparty's existing frontend
- `06-rewrite-feasibility.md` — strategy
- `07-killer-features.md` — what to preserve
- `08-kiosk-usb-setup.md` — architecture for this project
- `09-electron-stack.md` — toolchain rationale

`CLAUDE.md` is the entry point for new chats.
