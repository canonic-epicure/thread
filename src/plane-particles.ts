import * as THREE from 'three'

const PLANE_PARTICLE_COUNT          = 30
const PLANE_PARTICLE_SPEED_MIN      = 0.6
const PLANE_PARTICLE_SPEED_MAX      = 1.6
const PLANE_PARTICLE_LIFE_MIN       = 0.35
const PLANE_PARTICLE_LIFE_MAX       = 1.35
const PLANE_PARTICLE_TRAIL_SECONDS  = 0.1
const PLANE_PARTICLE_EDGE_PADDING   = 0.1
const PLANE_PARTICLE_HEIGHT_OFFSET  = 0.0
const PLANE_PARTICLE_WIDTH          = 0.01
const PLANE_PARTICLE_THICKNESS      = 0.03
const PLANE_PARTICLE_SURFACE_OFFSET = 0.002
const PLANE_PARTICLE_HEAD_LENGTH    = 0.35

type PlaneParticle = {
    pos: THREE.Vector2
    vel: THREE.Vector2
    speed: number
    age: number
    life: number
}

export function createPlaneParticles(
    half: number,
    getPlaneHeightAt: (x: number, y: number) => number
): {
    object: THREE.Mesh
    update: (delta: number) => void
} {
    const particles: PlaneParticle[] = []
    const baseQuad                   = new THREE.BoxGeometry(1, 1, 1)
    const geometry                   = new THREE.InstancedBufferGeometry()
    geometry.index                   = baseQuad.index
    geometry.attributes.position     = baseQuad.attributes.position
    geometry.attributes.uv           = baseQuad.attributes.uv
    geometry.instanceCount           = PLANE_PARTICLE_COUNT

    const tailArray  = new Float32Array(PLANE_PARTICLE_COUNT * 3)
    const headArray  = new Float32Array(PLANE_PARTICLE_COUNT * 3)
    const alphaArray = new Float32Array(PLANE_PARTICLE_COUNT * 2)
    const widthArray = new Float32Array(PLANE_PARTICLE_COUNT)
    geometry.setAttribute('aTail', new THREE.InstancedBufferAttribute(tailArray, 3))
    geometry.setAttribute('aHead', new THREE.InstancedBufferAttribute(headArray, 3))
    geometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alphaArray, 2))
    geometry.setAttribute('aWidth', new THREE.InstancedBufferAttribute(widthArray, 1))

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
            uColor: { value: new THREE.Color(0.85, 0.92, 1.0) },
            uThickness: { value: PLANE_PARTICLE_THICKNESS },
            uSurfaceOffset: { value: PLANE_PARTICLE_SURFACE_OFFSET },
            uHeadLength: { value: PLANE_PARTICLE_HEAD_LENGTH }
        },
        vertexShader: `
            attribute vec3 aTail;
            attribute vec3 aHead;
            attribute vec2 aAlpha;
            attribute float aWidth;
            uniform vec3 uColor;
            uniform float uThickness;
            uniform float uSurfaceOffset;
            uniform float uHeadLength;
            varying vec4 vColor;

            void main() {
                vec3 dir = aHead - aTail;
                float len = length(dir);
                vec3 dirNorm = len > 0.0001 ? dir / len : vec3(1.0, 0.0, 0.0);
                vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), dirNorm));
                vec3 up = vec3(0.0, 0.0, 1.0);
                vec3 center = (aHead + aTail) * 0.5;
                float heightOffset = (position.z * uThickness) - (0.5 * uThickness) + uSurfaceOffset;
                vec3 offset =
                    dirNorm * (position.x * len) +
                    right * (position.y * aWidth) +
                    up * heightOffset;
                float t = position.x + 0.5;
                float headT = clamp(uHeadLength, 0.0, 1.0);
                float alpha = t >= (1.0 - headT)
                    ? aAlpha.y
                    : mix(aAlpha.x, aAlpha.y, t / max(0.0001, 1.0 - headT));
                vColor = vec4(uColor, alpha);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(center + offset, 1.0);
            }
        `,
        fragmentShader: `
            varying vec4 vColor;
            void main() {
                if (vColor.a < 0.01) {
                    discard;
                }
                gl_FragColor = vColor;
            }
        `
    })

    const mesh         = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder   = 1

    const spawnParticle = (particle: PlaneParticle) => {
        const range = half - PLANE_PARTICLE_EDGE_PADDING
        particle.pos.set(
            THREE.MathUtils.randFloatSpread(range * 2),
            THREE.MathUtils.randFloatSpread(range * 2)
        )
        const angle = Math.random() * Math.PI * 2
        particle.vel.set(Math.cos(angle), Math.sin(angle))
        particle.speed = THREE.MathUtils.lerp(
            PLANE_PARTICLE_SPEED_MIN,
            PLANE_PARTICLE_SPEED_MAX,
            Math.random()
        )
        particle.age   = 0
        particle.life  = THREE.MathUtils.lerp(
            PLANE_PARTICLE_LIFE_MIN,
            PLANE_PARTICLE_LIFE_MAX,
            Math.random()
        )
    }

    for (let i = 0; i < PLANE_PARTICLE_COUNT; i += 1) {
        const particle: PlaneParticle = {
            pos: new THREE.Vector2(),
            vel: new THREE.Vector2(1, 0),
            speed: 0,
            age: 0,
            life: 1
        }
        spawnParticle(particle)
        particles.push(particle)
    }

    const update = (delta: number) => {
        const range = half + PLANE_PARTICLE_EDGE_PADDING
        for (let i = 0; i < particles.length; i += 1) {
            const particle = particles[i]
            particle.age  += delta
            if (
                particle.age >= particle.life ||
                Math.abs(particle.pos.x) > range ||
                Math.abs(particle.pos.y) > range
            ) {
                spawnParticle(particle)
            }

            const step      = particle.speed * delta
            particle.pos.x += particle.vel.x * step
            particle.pos.y += particle.vel.y * step

            const lifeT     = THREE.MathUtils.clamp(1 - particle.age / particle.life, 0, 1)
            const alphaHead = 0.7 * lifeT
            const alphaTail = 0.0
            const trail     = Math.max(0.01, particle.speed * PLANE_PARTICLE_TRAIL_SECONDS)
            const tailX     = particle.pos.x - particle.vel.x * trail
            const tailY     = particle.pos.y - particle.vel.y * trail

            const zHead = getPlaneHeightAt(particle.pos.x, particle.pos.y) + PLANE_PARTICLE_HEIGHT_OFFSET
            const zTail = getPlaneHeightAt(tailX, tailY) + PLANE_PARTICLE_HEIGHT_OFFSET

            const tailIndex          = i * 3
            tailArray[tailIndex]     = tailX
            tailArray[tailIndex + 1] = tailY
            tailArray[tailIndex + 2] = zTail
            headArray[tailIndex]     = particle.pos.x
            headArray[tailIndex + 1] = particle.pos.y
            headArray[tailIndex + 2] = zHead

            const alphaIndex           = i * 2
            alphaArray[alphaIndex]     = alphaTail
            alphaArray[alphaIndex + 1] = alphaHead
            widthArray[i]              = PLANE_PARTICLE_WIDTH
        }

        geometry.attributes.aTail.needsUpdate  = true
        geometry.attributes.aHead.needsUpdate  = true
        geometry.attributes.aAlpha.needsUpdate = true
        geometry.attributes.aWidth.needsUpdate = true
    }

    return { object: mesh, update }
}
