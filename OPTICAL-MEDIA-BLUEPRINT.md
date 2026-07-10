# Technical Blueprint: Offline Optical Media Pipeline

## 1. System Architecture & Constraints
This document outlines the technical requirements for integrating optical media (DVDs) into a local data ecosystem. The architecture assumes deployment across two primary environments:
* **Backend / Server:** Containerized environments (Docker) running on a local NAS (e.g., Ugreen).
* **Frontend / Interface:** Electron-based desktop application.
* **Network Constraint:** The system is designed for a completely offline, localized "Sneakernet" experience (such as the Agora project). It explicitly rejects internet dependency for decryption, metadata retrieval, or playback.

## 2. Frontend Interface (Electron)
To access local DVD filesystems within an Electron application, the Node.js `fs` module must be isolated in the Main Process to maintain security, communicating with the Renderer via IPC.

### 2.1. Drive Detection
Because optical drive mount paths vary by OS, dynamic detection is required.
* **Dependency:** `drivelist` (npm package)
* **Logic:** Filter the output of `drivelist.list()` for drives where `isReadOnly` and `isRemovable` are true.

### 2.2. IPC Implementation
**Main Process (Node.js):**

```javascript
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const drivelist = require('drivelist');

ipcMain.handle('read-dvd-directory', async () => {
  const drives = await drivelist.list();
  const dvdDrive = drives.find(d => d.isReadOnly && d.isRemovable);
  
  if (!dvdDrive || dvdDrive.mountpoints.length === 0) throw new Error('No DVD found.');
  
  const dvdPath = dvdDrive.mountpoints[0].path;
  const videoTsPath = path.join(dvdPath, 'VIDEO_TS');
  const targetPath = fs.existsSync(videoTsPath) ? videoTsPath : dvdPath;
  
  return { path: targetPath, files: fs.readdirSync(targetPath) };
});
```

**Preload Script:**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readDVD: () => ipcRenderer.invoke('read-dvd-directory')
});
```

### 2.3. Playback Limitations
Electron's Chromium backend does not natively support HTML5 playback of encrypted `.VOB` (MPEG-2) files found on commercial DVDs. For playback, the media must be decrypted and transcoded by a backend process.

## 3. Backend Processing (Linux Ripping Pipeline)
For server-side extraction and processing of DVDs, Linux utilizes a three-step pipeline relying on open-source libraries.

### 3.1. Decryption
* **Component:** `libdvdcss2`
* **Function:** Dynamically bypasses CSS (Content Scramble System) encryption, allowing standard filesystem read operations without requiring external internet validation.

### 3.2. Extraction (Remuxing)
* **Tool:** MakeMKV
* **Function:** Extracts raw, untouched audio and video streams from `.VOB` files and repackages them into a `.mkv` container. Results in a 1:1 lossless copy (typically 4-8 GB per disc).

### 3.3. Transcoding
* **Tool:** HandBrake / FFmpeg
* **Function:** Compresses the raw MPEG-2 `.mkv` into a modern codec (H.264/H.265) suitable for local streaming or storage, reducing file size significantly.

### 3.4. Containerized Automation
For a NAS deployment, this pipeline can be fully containerized:
* **Docker Integration:** Pass the optical drive block device (e.g., `--device=/dev/sr0`) directly to the container.
* **Automation:** Suites like Automatic Ripping Machine (ARM) can be run via Docker Compose to automatically detect a disc insertion, rip via MakeMKV, transcode via HandBrake, and eject the disc entirely headless.

## 4. LLM Directives for Future Prompts
* When proposing code modifications to this pipeline, ensure all solutions operate 100% offline.
* Assume the user is comfortable with Docker Compose orchestration.
* Focus on local data sovereignty; do not suggest cloud-based APIs for media scraping or key retrieval.
