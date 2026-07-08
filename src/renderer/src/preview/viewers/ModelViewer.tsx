import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js'
import { Box, Grid3x3, Palette, Triangle } from 'lucide-react'
import type { PreviewSource } from '../../../../shared/types'
import { Button } from '@/components/ui/button'

type ShadingMode = 'solid' | 'wireframe' | 'normals' | 'matcap'

const MODES: { id: ShadingMode; label: string; icon: React.ReactNode }[] = [
  { id: 'solid', label: 'Solid', icon: <Box /> },
  { id: 'wireframe', label: 'Wireframe', icon: <Grid3x3 /> },
  { id: 'normals', label: 'Normals', icon: <Triangle /> },
  { id: 'matcap', label: 'Matcap', icon: <Palette /> }
]

/** Erzeugt eine lokale Matcap-Textur (radialer Grau-Verlauf) ohne externes Bild. */
function makeMatcapTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // radialer Verlauf: heller Lichtpunkt oben-links, dunkler Rand
  const grad = ctx.createRadialGradient(size * 0.35, size * 0.35, size * 0.05, size * 0.5, size * 0.5, size * 0.6)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.4, '#c8c8c8')
  grad.addColorStop(1, '#404040')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Bytes → three-Object3D je nach Extension via .parse() (NIE .load(url)). */
async function parseModel(ext: string, bytes: Uint8Array): Promise<THREE.Object3D> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const loader = new GLTFLoader()
      const data: ArrayBuffer | string = ext === 'gltf' ? new TextDecoder().decode(bytes) : ab
      const gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.parse(data, '', resolve, (err) => reject(err))
      })
      return gltf.scene
    }
    case 'obj':
      return new OBJLoader().parse(new TextDecoder().decode(bytes))
    case 'stl': {
      const geo = new STLLoader().parse(ab)
      geo.computeVertexNormals()
      return new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.6 })
      )
    }
    case 'fbx':
      return new FBXLoader().parse(ab, '')
    case 'usdz':
      return new USDZLoader().parse(ab)
    default:
      throw new Error(`Unsupported format: ${ext}`)
  }
}

export function ModelViewer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [mode, setMode] = useState<ShadingMode>('solid')

  // Refs auf three-Objekte für Shading-Umschaltung + Cleanup
  const meshesRef = useRef<THREE.Mesh[]>([])
  const originalMatsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map())
  const sharedMatsRef = useRef<{
    wireframe: THREE.MeshBasicMaterial
    normals: THREE.MeshNormalMaterial
    matcap: THREE.MeshMatcapMaterial
    matcapTex: THREE.CanvasTexture
  } | null>(null)

  // Aktueller Modus als Ref, damit init() nach dem Laden den Startmodus anwenden kann
  const modeRef = useRef<ShadingMode>(mode)
  modeRef.current = mode

  function applyMode(next: ShadingMode): void {
    const shared = sharedMatsRef.current
    for (const mesh of meshesRef.current) {
      switch (next) {
        case 'solid': {
          const orig = originalMatsRef.current.get(mesh)
          if (orig) mesh.material = orig
          break
        }
        case 'wireframe':
          if (shared) mesh.material = shared.wireframe
          break
        case 'normals':
          if (shared) mesh.material = shared.normals
          break
        case 'matcap':
          if (shared) mesh.material = shared.matcap
          break
      }
    }
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let alive = true
    let rafId = 0
    let renderer: THREE.WebGLRenderer | null = null
    let controls: OrbitControls | null = null
    let resizeObserver: ResizeObserver | null = null
    const scene = new THREE.Scene()

    setLoading(true)
    setError(false)

    const init = async (): Promise<void> => {
      const bytes = await window.api.preview.readBytes(source)
      if (!alive) return
      if (!bytes) {
        setError(true)
        setLoading(false)
        return
      }

      const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
      let model: THREE.Object3D
      try {
        model = await parseModel(ext, bytes)
      } catch {
        if (alive) {
          setError(true)
          setLoading(false)
        }
        return
      }
      if (!alive) return

      // Meshes einsammeln + Originalmaterialien merken (für "Solid")
      const meshes: THREE.Mesh[] = []
      model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh
          meshes.push(m)
          originalMatsRef.current.set(m, m.material)
        }
      })
      meshesRef.current = meshes

      // Shared-Materialien für die Shading-Modes
      const matcapTex = makeMatcapTexture()
      sharedMatsRef.current = {
        wireframe: new THREE.MeshBasicMaterial({ color: 0x88ccff, wireframe: true }),
        normals: new THREE.MeshNormalMaterial(),
        matcap: new THREE.MeshMatcapMaterial({ matcap: matcapTex }),
        matcapTex
      }

      // Zentrieren + skalieren via Bounding-Box
      const box = new THREE.Box3().setFromObject(model)
      const center = new THREE.Vector3()
      const size = new THREE.Vector3()
      box.getCenter(center)
      box.getSize(size)
      model.position.sub(center) // Modell in den Ursprung schieben
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      scene.add(model)

      // Renderer
      const width = container.clientWidth || 1
      const height = container.clientHeight || 1
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      container.appendChild(renderer.domElement)
      renderer.domElement.style.position = 'absolute'
      renderer.domElement.style.inset = '0'
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'

      // Kamera: Distanz aus Bounding-Sphere ableiten
      const camera = new THREE.PerspectiveCamera(50, width / height, maxDim / 1000, maxDim * 100)
      const fitDist = (maxDim / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.6
      camera.position.set(fitDist * 0.7, fitDist * 0.5, fitDist)
      camera.lookAt(0, 0, 0)

      // Licht
      const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)
      scene.add(hemi)
      const dir = new THREE.DirectionalLight(0xffffff, 1.5)
      dir.position.set(fitDist, fitDist, fitDist)
      scene.add(dir)

      // Controls
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08

      // Resize
      resizeObserver = new ResizeObserver(() => {
        if (!renderer) return
        const w = container.clientWidth || 1
        const h = container.clientHeight || 1
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      resizeObserver.observe(container)

      // Render-Loop
      const animate = (): void => {
        rafId = requestAnimationFrame(animate)
        controls?.update()
        renderer?.render(scene, camera)
      }
      animate()

      applyMode(modeRef.current)
      setLoading(false)
    }

    void init()

    return () => {
      alive = false
      cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      controls?.dispose()

      // Geometrien / Materialien / Texturen aller Scene-Objekte disposen
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mat = originalMatsRef.current.get(mesh) ?? mesh.material
          for (const m of Array.isArray(mat) ? mat : [mat]) {
            if (!m) continue
            for (const key of Object.keys(m)) {
              const val = (m as unknown as Record<string, unknown>)[key]
              if (val instanceof THREE.Texture) val.dispose()
            }
            m.dispose()
          }
        }
      })

      // Shared-Materialien + Matcap-Textur disposen
      const shared = sharedMatsRef.current
      if (shared) {
        shared.wireframe.dispose()
        shared.normals.dispose()
        shared.matcap.dispose()
        shared.matcapTex.dispose()
      }
      sharedMatsRef.current = null
      meshesRef.current = []
      originalMatsRef.current.clear()

      // WebGL-Context freigeben (kein Leak bei 10× öffnen/schließen)
      if (renderer) {
        renderer.dispose()
        renderer.forceContextLoss()
        renderer.domElement.remove()
      }
      renderer = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.name, source])

  // Shading ohne Reload umschalten
  useEffect(() => {
    applyMode(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center gap-1 border-b px-3 py-2">
        {MODES.map((m) => (
          <Button
            key={m.id}
            variant={mode === m.id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode(m.id)}
          >
            {m.icon}
            {m.label}
          </Button>
        ))}
      </div>

      <div ref={containerRef} className="relative flex-1">
        {error ? (
          <div className="text-ink-muted absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-foreground">{entry.name}</span>
            <span>3D-Modell konnte nicht geladen werden</span>
          </div>
        ) : loading ? (
          <div className="text-ink-muted absolute inset-0 flex items-center justify-center">Lädt…</div>
        ) : null}
      </div>
    </div>
  )
}
