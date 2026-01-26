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

type SphereControllerOptions = {
    renderer: THREE.WebGLRenderer
    camera: THREE.PerspectiveCamera
    materialParams: {
        color: number
        roughness: number
        metalness: number
    }
    letterColor: string
    gridColor: string
    fontFamily: string
    text: string
}

type SphereController = {
    sphere: THREE.Object3D
    updateSphere: (delta: number) => void
    getSphereState: () => { isPointerDown: boolean; scrollSpeed: number }
    setSphereColor: (color: string | number) => void
    setSphereLetterColor: (letterColor: string, gridColor?: string) => void
    setSphereFont: (fontFamily: string) => void
    setSphereText: (text: string) => void
}

// Grid layout for the sphere texture (rectangular cells wrapped onto the sphere).
const SPHERE_COLUMN_COUNT = 32
const SPHERE_ROW_COUNT = 20
const SPHERE_TEXTURE_SIZE = 2048
const SPHERE_TEXTURE_OFFSET = 1 / (SPHERE_COLUMN_COUNT * 2)
// The front-facing UV for a sphere in three.js maps to u ≈ 0.75.
const SPHERE_GLOW_BLUR = 32
const SPHERE_GLOW_ALPHA = 0.85
const SPHERE_GLOW_COLOR = '#efefef'
const SPHERE_GLOW_SCALE = 1.2

// Scroll and inertia tuning for the sphere texture.
const sphereTextureScrollSpeed = 0.04
const sphereAutoScrollSpeed = -sphereTextureScrollSpeed
const sphereDragSpeedFactor = 0.1
const sphereMaxDragSpeed = 0.4
const sphereSlowdownTime = 0.3
const sphereResumeTime = 2.0

// Builds the 2D canvas that becomes the sphere texture.
// The grid is drawn first, then letters are placed in each cell.
// Each column uses a shifted index into the text buffer so columns differ but loop consistently.
function createSphereTexture(
    renderer: THREE.WebGLRenderer,
    letterColor: string,
    gridColor: string,
    fontFamily: string,
    text: string
): THREE.CanvasTexture {
    const safeText = text.length > 0 ? text : ' '
    const size = SPHERE_TEXTURE_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get 2D context')
    }

    ctx.clearRect(0, 0, size, size)

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
    ctx.font = `bold 40px ${fontFamily}`

    for (let col = 0; col < SPHERE_COLUMN_COUNT; col += 1) {
        // Column-based offset creates a vertical "text stream" per column.
        const columnOffset = (col * 7) % safeText.length
        for (let row = 0; row < SPHERE_ROW_COUNT; row += 1) {
            const index = (columnOffset + row) % safeText.length
            const char = safeText[index]
            const cx = col * cellWidth + cellWidth / 2
            const cy = row * cellHeight + cellHeight / 2
            if (col === Math.floor(SPHERE_COLUMN_COUNT / 4)) {
                ctx.save()
                ctx.globalAlpha = SPHERE_GLOW_ALPHA
                ctx.shadowColor = SPHERE_GLOW_COLOR
                ctx.shadowBlur = SPHERE_GLOW_BLUR
                ctx.shadowOffsetX = 0
                ctx.shadowOffsetY = 0
                ctx.globalCompositeOperation = 'lighter'
                ctx.fillStyle = SPHERE_GLOW_COLOR
                ctx.font = `bold ${Math.round(40 * SPHERE_GLOW_SCALE)}px ${fontFamily}`
                ctx.fillText(char, cx, cy)
                ctx.restore()
            }
            ctx.fillStyle = letterColor
            ctx.font = `bold 40px ${fontFamily}`
            ctx.fillText(char, cx, cy)
        }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    texture.needsUpdate = true
    return texture
}

export function createSphereController(options: SphereControllerOptions): SphereController {
    const { renderer, camera, materialParams, letterColor, gridColor, fontFamily, text } =
        options
    let currentLetterColor = letterColor
    let currentGridColor = gridColor
    let currentFontFamily = fontFamily
    let currentText = text
    let texture = createSphereTexture(
        renderer,
        currentLetterColor,
        currentGridColor,
        currentFontFamily,
        currentText
    )
    // Repeat wrapping allows endless vertical scrolling on the sphere.
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1, 1)
    // Offset by half a column so the center meridian aligns with a text column.
    texture.offset.set(SPHERE_TEXTURE_OFFSET, 0)

    // Sphere geometry stays fixed; motion is done by scrolling the texture.
    const sphereGeometry = new THREE.SphereGeometry(1, 64, 64)
    const sphereBaseMaterial = new THREE.MeshStandardMaterial({
        ...materialParams
    })
    const sphereTextMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        depthWrite: false
    })
    const baseSphere = new THREE.Mesh(sphereGeometry, sphereBaseMaterial)
    const textSphere = new THREE.Mesh(sphereGeometry, sphereTextMaterial)
    textSphere.scale.setScalar(1.002)
    const sphere = new THREE.Group()
    sphere.position.y = -0.5
    sphere.add(baseSphere, textSphere)

    const rebuildTexture = () => {
        const nextTexture = createSphereTexture(
            renderer,
            currentLetterColor,
            currentGridColor,
            currentFontFamily,
            currentText
        )
        nextTexture.wrapS = THREE.RepeatWrapping
        nextTexture.wrapT = THREE.RepeatWrapping
        nextTexture.repeat.set(1, 1)
        nextTexture.offset.set(SPHERE_TEXTURE_OFFSET, 0)
        texture.dispose()
        texture = nextTexture
        sphereTextMaterial.map = texture
        sphereTextMaterial.needsUpdate = true
    }


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
        const hit = sphereRaycaster.intersectObject(baseSphere, false)
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

    const getSphereState = () => ({
        isPointerDown: isSpherePointerDown,
        scrollSpeed: currentScrollSpeed
    })

    return {
        sphere,
        updateSphere,
        getSphereState,
        setSphereColor: (color: string | number) => {
            sphereBaseMaterial.color.set(color)
        },
        setSphereLetterColor: (nextLetterColor: string, nextGridColor?: string) => {
            currentLetterColor = nextLetterColor
            currentGridColor = nextGridColor ?? nextLetterColor
            rebuildTexture()
        },
        setSphereFont: (nextFontFamily: string) => {
            currentFontFamily = nextFontFamily
            rebuildTexture()
        },
        setSphereText: (nextText: string) => {
            if (nextText === currentText) {
                return
            }
            currentText = nextText
            rebuildTexture()
        }
    }
}
