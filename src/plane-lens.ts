import * as THREE from 'three'

export const PLANE_LENS_COUNT = 5
export const PLANE_LENS_RADIUS_MIN = 0.2
export const PLANE_LENS_RADIUS_MAX = 1
export const PLANE_LENS_STRENGTH_MIN = 0.09
export const PLANE_LENS_STRENGTH_MAX = 0.18
export const PLANE_LENS_SPEED_MIN = 0.05
export const PLANE_LENS_SPEED_MAX = 0.25
export const PLANE_LENS_BOUNDS_SCALE = 0.5
export const PLANE_LENS_LIFE_MIN = 3.5
export const PLANE_LENS_LIFE_MAX = 7.5
export const PLANE_LENS_FADE_IN = 0.5
export const PLANE_LENS_FADE_OUT = 0.5

type PlaneLens = {
    pos: THREE.Vector2
    vel: THREE.Vector2
    radius: number
    baseStrength: number
    baseSpeed: number
    age: number
    life: number
}

type PlaneLensUniforms = {
    pos: THREE.Vector2[]
    radius: number[]
    strength: number[]
}

export function createPlaneLenses(
    half: number,
    uniforms: PlaneLensUniforms
): {
    update: (delta: number) => void
} {
    const lensParticles: PlaneLens[] = []
    const lensBounds                 = half * PLANE_LENS_BOUNDS_SCALE
    const spawnLens                  = (lens: PlaneLens, randomAge: boolean) => {
        const angle = Math.random() * Math.PI * 2
        lens.pos.set(
            THREE.MathUtils.randFloatSpread(lensBounds),
            THREE.MathUtils.randFloatSpread(lensBounds)
        )
        lens.vel.set(Math.cos(angle), Math.sin(angle))
        lens.radius       = THREE.MathUtils.lerp(
            PLANE_LENS_RADIUS_MIN,
            PLANE_LENS_RADIUS_MAX,
            Math.random()
        )
        lens.baseStrength = THREE.MathUtils.lerp(
            PLANE_LENS_STRENGTH_MIN,
            PLANE_LENS_STRENGTH_MAX,
            Math.random()
        )
        lens.baseSpeed    = THREE.MathUtils.lerp(
            PLANE_LENS_SPEED_MIN,
            PLANE_LENS_SPEED_MAX,
            Math.random()
        )
        lens.life         = THREE.MathUtils.lerp(PLANE_LENS_LIFE_MIN, PLANE_LENS_LIFE_MAX, Math.random())
        lens.age          = randomAge ? Math.random() * lens.life : 0
    }

    for (let i = 0; i < PLANE_LENS_COUNT; i += 1) {
        const lens: PlaneLens = {
            pos: new THREE.Vector2(),
            vel: new THREE.Vector2(),
            radius: 0,
            baseStrength: 0,
            baseSpeed: 0,
            age: 0,
            life: 1
        }
        spawnLens(lens, true)
        lensParticles.push(lens)
    }

    const update = (delta: number) => {
        for (let i = 0; i < lensParticles.length; i += 1) {
            const lens = lensParticles[i]
            lens.age  += delta
            if (lens.age >= lens.life) {
                spawnLens(lens, false)
            }
            const lifeT      = lens.life > 0 ? THREE.MathUtils.clamp(lens.age / lens.life, 0, 1) : 1
            const fadeIn     = THREE.MathUtils.smoothstep(
                lifeT,
                0,
                PLANE_LENS_FADE_IN
            )
            const fadeOut    = 1 -
                THREE.MathUtils.smoothstep(
                    lifeT,
                    1 - PLANE_LENS_FADE_OUT,
                    1
                )
            const fade       = fadeIn * fadeOut
            const speedScale = fade
            lens.pos.x      += lens.vel.x * lens.baseSpeed * speedScale * delta
            lens.pos.y      += lens.vel.y * lens.baseSpeed * speedScale * delta
            if (lens.pos.x > lensBounds) lens.pos.x = -lensBounds
            if (lens.pos.x < -lensBounds) lens.pos.x = lensBounds
            if (lens.pos.y > lensBounds) lens.pos.y = -lensBounds
            if (lens.pos.y < -lensBounds) lens.pos.y = lensBounds
            uniforms.pos[i].copy(lens.pos)
            uniforms.radius[i]   = lens.radius
            uniforms.strength[i] = lens.baseStrength * fade
        }
    }

    return { update }
}
