# Mobile-Upload via QR — E2E-Checkliste

Manuelle Abnahme am echten Kiosk + echtem Phone (nicht automatisierbar,
siehe `test_mobile_upload.py` für die Route-Tests). Voraussetzung: `agora-server`
läuft auf Kiosk2 (`server.py`), copyparty läuft (`:3923`), FritzBox-WLAN „Agora"
aktiv.

- [ ] **WLAN-QR im Datentausch-Tray scannen** → Phone verbindet sich automatisch
      mit dem WLAN „Agora" (kein Passwort nötig)
- [ ] **URL-QR scannen** → Upload-Seite lädt im Phone-Browser
      (`http://192.168.178.71:8080/up`)
- [ ] **Modus „Fotos"**: mehrere Bilder aus der Galerie wählen → Upload läuft
      → Dateien sind in copyparty/Agora sichtbar (auf einem Kiosk-Screen
      gegenprüfen)
- [ ] **Modus „Dateien"**: beliebige Datei wählen → Upload läuft → Datei ist
      sichtbar
- [ ] **Modus „Foto machen"**: Kamera öffnet → Foto aufnehmen → Preview
      erscheint → „Foto zur Agora hinzufügen" → Datei ist sichtbar
- [ ] **Modus „Foto machen" — Abbrechen**: Kamera öffnet → Foto aufnehmen →
      Preview erscheint → „Abbrechen" → Foto wird verworfen, kein Upload
- [ ] **iOS Safari**: alle drei Modi mindestens einmal erfolgreich getestet
- [ ] **Android Chrome**: alle drei Modi mindestens einmal erfolgreich getestet
- [ ] **Dashboard-Zähler**: `/stats` bzw. `/dashboard` zeigt nach den obigen
      Uploads einen erhöhten Transfer-Zähler (`files_transferred` /
      `bytes_transferred`, `transfer`-Event mit `kiosk:"mobile"`)
