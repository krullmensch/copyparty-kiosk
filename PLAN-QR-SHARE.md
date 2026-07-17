# PLAN — "Download to Smartphone" (QR-Share)

Stand: 2026-07-17. Rolle: Architect. Dieses Dokument ist die Spec für die Developer-/Test-Writer-/Reviewer-Subagents.

## Ziel

Rechtsklick auf Datei(en) in der **RemoteBrowserPane** → Kontextmenü → „Auf Smartphone laden" → Dialog mit QR-Code. Handy (im Agora-WLAN, kein Uplink) scannt → Browser öffnet → Download startet.

Pro Datei / pro Auswahl wird **jedes Mal ein neuer Share** erzeugt. Kein Cache, keine Wiederverwendung.

## Entscheidungen (getroffen, nicht mehr zu diskutieren)

| Frage | Entscheidung | Grund |
|---|---|---|
| Mechanik | copyparty **shares** (`--shr /s`) | kurzer QR, echte Expiry, Multi-File; kein Eigenbau-Server |
| Scope | nur **RemoteBrowserPane** | lokale USB-Dateien sind nicht in copyparty; out of scope |
| Auth für Share-Erstellung | eigener copyparty-Account `qr`, Passwort in `~/.agora/share.pw` | `shr_who=auth` lehnt Anon (`*`) ab. Anon-`a`(admin)-Perm wurde **verworfen**: würde Uploader-IPs für jeden im WLAN sichtbar machen — widerspricht dem MAC-Hashing-Ansatz der Installation |
| Browsing bleibt anon | ja | Share-POST schickt `Cookie: cppwd=<pw>` nur für diesen einen Request. `connect()`-Statemachine wird **nicht** angefasst |
| QR-Host | **IPv4**, per `dns.lookup(host,{family:4})` aufgelöst | Android-mDNS unzuverlässig; `kiosk2.local` im QR = tote Links |
| QR-Lib | `qrcode.react@4.2.0` | zero runtime deps, React-19-Peer, rein lokal (kein CDN) |
| Expiry | 60 min | |
| Byte-Zählung | Event `qr_share` bei **Erstellung** (freigegebene Bytes) | copyparty exportiert keine tx-Bytes (`metrics.py` hat keinen Byte-Counter), Access-Log-Parsing ist ANSI-verseucht und fragil. Semantik ehrlich labeln: „freigegeben", nicht „geladen" |
| Screensaver | **nicht bauen** | existiert im Code noch gar nicht (kein `powerMonitor` in `src/`). 3-min-Idle + Suppression-bei-QR/Medium wird nur als Spec in `TODO.md` festgehalten |
| Netzwerkscan für Handy-Zählung | **nicht in diesem Plan** | eigenes Feature am Poller (`agora-dashboard/poller.py`), berührt QR nicht |

## Verifizierte Fakten aus dem copyparty-Source

- `POST /?share`, Body `text/plain` mit JSON `{k, vp[], pw, exp, perms}` → `httpcli.py:6389` (`handle_share`), Dispatch `httpcli.py:3002`.
- `k` (Sharekey) wird **vom Client** gewählt. Regex-Gate: `[^0-9a-zA-Z_-]` → Fehler. Bereits vergeben → 400 `sharekey ... is already in use`.
- `exp` = Minuten als String, `""`/`"0"` = unendlich.
- `perms` = Teilmenge von `read|write|get|dot`.
- Multi-File: alle `vp` müssen im **selben Ordner** liegen; kein Mix Datei+Ordner; max. 1 Ordner. Sonst 400.
- Antwort: 201, Text `created share: <url>` (URL ab Index 15).
- `?dl` erzwingt `Content-Disposition: attachment` → `httpcli.py:4643`.
- Selection-ZIP per GET gibt es **nicht** (`handle_zip_post` braucht multipart-POST `files`) — deshalb der Umweg über Shares.
- Perm-Buchstabe `a` = uadmin (`authsrv.py:3833`), sieht Uploader-IPs (README:545) → verworfen, s.o.

## Server-Config-Änderung (kiosk2)

Live-Args heute: `-v $HOME/copyparty-data:/:rwd -e2dsa --no-ses --daw --u2ow 2 -lo ...`

Neu **zusätzlich**: `-a qr:<PW> --shr /s --shr-rt 60`

- `--shr /s` legt das virtuelle Toplevel `/s` an. `e2d` (für Share-Cleanup) ist über `-e2dsa` schon da.
- `--shr-who` bleibt Default `auth`.
- `-a qr:<PW>` ändert die Anon-Rechte **nicht** — `:rwd` gilt weiter für alle.
- `~/.agora/share.pw` auf **allen drei Kiosken** = `<PW>`, `chmod 600`.
- ⚠️ `deploy/setup-main.sh:83` ist gegenüber dem Live-Stand veraltet (`:rw`, `-q`, kein `--daw`/`-lo`). Beim Anfassen den Live-Stand nachziehen, **nicht** überschreiben.
- Deploy macht **Marvin**. Kein Subagent fasst die Kioske per SSH an.

## Kontrakte (verbindlich — Wave 1 legt sie an, Wave 2 baut dagegen)

### `src/shared/types.ts`

```ts
export interface ShareResult { ok: boolean; url?: string; key?: string
  expiresAt?: number; files?: number; bytes?: number; error?: string }
// IpcChannels: CppShare: 'cpp:share'
// AgoraEvent:  | { kind: 'qr_share'; kiosk: string; files: number; bytes: number
//                  exts: Record<string, { count: number; bytes: number }> }
// AgoraStats:  qr_shares?: number; qr_bytes?: number
```

### `src/preload/index.ts` (Gruppe `cpp`)

```ts
share: (url: string, items: { vpath: string; name: string; size: number; isDirectory: boolean }[])
  => Promise<ShareResult>
```

### URL-Bau

- 1 Datei → `http://<ip>:3923/s/<key>/<encodeURIComponent(name)>?dl`
- sonst (n Dateien oder 1 Ordner) → `http://<ip>:3923/s/<key>/?zip`

Die vom Server zurückgegebene URL wird **ignoriert** (sie trägt den Host-Header, evtl. `kiosk2.local`). Der Key ist client-gewählt, die URL wird selbst gebaut.

## Wellen

### Wave 0 — Verifier (Sonnet 5), synchron, blockierend

Lokale copyparty-Instanz aus `../copyparty` auf `127.0.0.1:3924` mit `--shr /s -a qr:test`. Per curl beweisen:
1. `POST /?share` mit `Cookie: cppwd=test` legt Share an; Anon (ohne Cookie) wird abgelehnt.
2. `GET /s/<k>/<fn>?dl` liefert `Content-Disposition: attachment`.
3. **Kritisch:** `GET /s/<k>/?zip` bei einem Share mit File-Selection (`nf>0`) liefert ein ZIP mit **genau** den ausgewählten Dateien.
4. Fehlertexte für Mix Datei+Ordner und für Key-Kollision.

Schlägt (3) fehl → Fallback ist die Share-Listing-Seite als QR-Ziel; Plan wird angepasst.

### Wave 1 — Developer Main (Sonnet 5)

`src/main/ipc/share.ts` (neu, self-contained), Typen, Preload, Registrierung in `src/main/index.ts`, `qr_share`-Event in `agora-events.ts`.

### Wave 2 — parallel

- **B** Developer Renderer (Sonnet 5): radix `ContextMenu` auf den Remote-Rows + `QrShareDialog.tsx` + `qrcode.react`-Dep.
- **C** Test-Writer (Haiku 4.5): Unit-Tests für die reinen Funktionen (Keygen, Request-Body, URL-Bau, Selection-Validierung).
- **D** Developer Deploy/Docs (Haiku 4.5): `deploy/setup-main.sh`, `deploy/README.md`, `CLAUDE.md`, `TODO.md` (inkl. Screensaver-Spec).
- **E** Developer Dashboard (Sonnet 5): `agora-dashboard/server.py` `qr_share`-Ingest + Stats-Felder + `AgoraStatsPanel.tsx`.

### Wave 3 — Reviewer (parallel)

`cavecrew-reviewer` gegen diese Spec.

## Definition of Ready

- `npm run typecheck` grün, `npm test` grün.
- Rechtsklick auf 1 Datei → QR; auf n Dateien → QR; auf 1 Ordner → QR.
- Selection mit Mix Datei+Ordner oder >1 Ordner → Menüpunkt deaktiviert mit Begründung im `title`.
- Fehlendes `~/.agora/share.pw` → klare Fehlermeldung, kein Crash.
- QR-Fläche: weißes Quiet-Zone-Feld auch im Dark Mode.
- Keine externen Netzwerk-Abhängigkeiten (kein CDN, keine Cloud-API).
