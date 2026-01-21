/*
    Sphere behavior overview:
    - A static sphere mesh is created and added to the scene; the mesh itself does not rotate.
    - A canvas texture is generated with a rectangular grid and per-column text offsets.
    - The texture scrolls vertically (UV offset), creating the illusion of letters flowing on the sphere.
    - Pointer dragging on the sphere applies inertial impulses to the scroll speed.
    - When the mouse is held down without movement, the speed eases toward 0; on release, it eases
      back to the default auto-scroll speed over time.
*/
import * as THREE from 'three'
import { LONG_TEXT } from './longText'

type SphereControllerOptions = {
    renderer: THREE.WebGLRenderer
    camera: THREE.PerspectiveCamera
    scene: THREE.Scene
    materialParams: {
        color: number
        roughness: number
        metalness: number
    }
    letterColor: string
    gridColor: string
}

type SphereController = {
    sphereMaterial: THREE.MeshStandardMaterial
    updateSphere: (delta: number) => void
}

// Grid layout for the sphere texture (rectangular cells wrapped onto the sphere).
const SPHERE_COLUMN_COUNT = 32
const SPHERE_ROW_COUNT = 20
const SPHERE_TEXTURE_SIZE = 2048
const SPHERE_TEXTURE_OFFSET = 1 / (SPHERE_COLUMN_COUNT * 2)

// Scroll and inertia tuning for the sphere texture.
const sphereTextureScrollSpeed = 0.04
const sphereAutoScrollSpeed = -sphereTextureScrollSpeed
const sphereDragSpeedFactor = 0.1
const sphereMaxDragSpeed = 0.2
const sphereSlowdownTime = 0.3
const sphereResumeTime = 2.0

// Builds the 2D canvas that becomes the sphere texture.
// The grid is drawn first, then letters are placed in each cell.
// Each column uses a shifted index into LONG_TEXT so columns differ but loop consistently.
function createSphereTexture(
    renderer: THREE.WebGLRenderer,
    letterColor: string,
    gridColor: string
): THREE.CanvasTexture {
    const size = SPHERE_TEXTURE_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get 2D context')
    }

    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, size, size)

    const cellWidth = size / SPHERE_COLUMN_COUNT
    const cellHeight = size / SPHERE_ROW_COUNT

    ctx.strokeStyle = gridColor
    ctx.lineWidth = 2
    for (let i = 0; i <= SPHERE_COLUMN_COUNT; i += 1) {
        const x = i * cellWidth
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, size)
        ctx.stroke()
    }
    for (let j = 0; j <= SPHERE_ROW_COUNT; j += 1) {
        const y = j * cellHeight
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(size, y)
        ctx.stroke()
    }

    ctx.fillStyle = letterColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 40px monospace'

    for (let col = 0; col < SPHERE_COLUMN_COUNT; col += 1) {
        // Column-based offset creates a vertical "text stream" per column.
        const columnOffset = (col * 7) % LONG_TEXT.length
        for (let row = 0; row < SPHERE_ROW_COUNT; row += 1) {
            const index = (columnOffset + row) % LONG_TEXT.length
            const char = LONG_TEXT[index]
            const cx = col * cellWidth + cellWidth / 2
            const cy = row * cellHeight + cellHeight / 2
            ctx.fillText(char, cx, cy)
        }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    texture.needsUpdate = true
    return texture
}

export function createSphereController(options: SphereControllerOptions): SphereController {
    const { renderer, camera, scene, materialParams, letterColor, gridColor } = options
    const texture = createSphereTexture(renderer, letterColor, gridColor)
    // Repeat wrapping allows endless vertical scrolling on the sphere.
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1, 1)
    // Offset by half a column so the center meridian aligns with a text column.
    texture.offset.set(SPHERE_TEXTURE_OFFSET, 0)

    // Sphere geometry stays fixed; motion is done by scrolling the texture.
    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 64),
        new THREE.MeshStandardMaterial({
            map: texture,
            ...materialParams
        })
    )
    sphere.position.y = -0.5
    scene.add(sphere)

    const sphereMaterial = sphere.material as THREE.MeshStandardMaterial

    // Raycast hit-testing ensures dragging only starts when clicking the sphere.
    const sphereRaycaster = new THREE.Raycaster()
    const spherePointer = new THREE.Vector2()
    let isSpherePointerDown = false
    let lastPointerY = 0
    let lastPointerTime = 0
    // currentScrollSpeed is the instantaneous scroll velocity.
    // currentBaseSpeed is the target speed (0 while pressed, auto speed after release).
    let currentScrollSpeed = sphereAutoScrollSpeed
    let targetScrollSpeed = sphereAutoScrollSpeed
    let currentBaseSpeed = sphereAutoScrollSpeed

    renderer.domElement.addEventListener('pointerdown', (event) => {
        spherePointer.x = (event.clientX / window.innerWidth) * 2 - 1
        spherePointer.y = -(event.clientY / window.innerHeight) * 2 + 1
        sphereRaycaster.setFromCamera(spherePointer, camera)
        const hit = sphereRaycaster.intersectObject(sphere, false)
        if (hit.length === 0) {
            return
        }
        // Start drag: base speed goes to zero and inertia slows the scroll.
        isSpherePointerDown = true
        currentBaseSpeed = 0
        lastPointerY = event.clientY
        lastPointerTime = performance.now()
        renderer.domElement.setPointerCapture(event.pointerId)
    })

    renderer.domElement.addEventListener('pointermove', (event) => {
        if (!isSpherePointerDown) {
            return
        }
        const now = performance.now()
        const deltaY = event.clientY - lastPointerY
        const deltaTime = Math.max(8, now - lastPointerTime)
        lastPointerY = event.clientY
        lastPointerTime = now
        const velocity = deltaY / deltaTime
        // Drag impulses add to the current velocity, allowing stacked pushes.
        const impulse = THREE.MathUtils.clamp(
            velocity * sphereDragSpeedFactor,
            -sphereMaxDragSpeed,
            sphereMaxDragSpeed
        )
        currentScrollSpeed = THREE.MathUtils.clamp(
            currentScrollSpeed + impulse,
            -sphereMaxDragSpeed,
            sphereMaxDragSpeed
        )
    })

    renderer.domElement.addEventListener('pointerup', (event) => {
        if (!isSpherePointerDown) {
            return
        }
        isSpherePointerDown = false
        // Release drag: ease back to the auto-scroll speed.
        currentBaseSpeed = sphereAutoScrollSpeed
        renderer.domElement.releasePointerCapture(event.pointerId)
    })

    renderer.domElement.addEventListener('pointercancel', (event) => {
        if (!isSpherePointerDown) {
            return
        }
        isSpherePointerDown = false
        currentBaseSpeed = sphereAutoScrollSpeed
        renderer.domElement.releasePointerCapture(event.pointerId)
    })

    // Called once per frame from main.ts; applies inertia and scrolls the texture.
    const updateSphere = (delta: number) => {
        sphere.rotation.y = 0
        sphere.rotation.x = 0

        targetScrollSpeed = currentBaseSpeed
        const timeConstant =
            targetScrollSpeed === 0 ? sphereSlowdownTime : sphereResumeTime
        const smoothing = 1 - Math.exp(-delta / timeConstant)
        // Ease current speed toward the target speed for smooth inertia.
        currentScrollSpeed += (targetScrollSpeed - currentScrollSpeed) * smoothing

        // UV scroll drives the visual motion of letters on the sphere.
        texture.offset.y = (texture.offset.y + currentScrollSpeed * delta + 1) % 1
    }

    return { sphereMaterial, updateSphere }
}
