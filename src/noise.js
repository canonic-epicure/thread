export const createNoiseShader = (amount = 0.061125, scale = 2.8, speed = 0.12) => ({
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uAmount: { value: amount },
        uScale: { value: scale },
        uSpeed: { value: speed }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAmount;
        uniform float uScale;
        uniform float uSpeed;
        varying vec2 vUv;

        float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 34.345);
            return fract(p.x * p.y);
        }

        float noise2d(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) +
                (c - a) * u.y * (1.0 - u.x) +
                (d - b) * u.x * u.y;
        }

        float pinkNoise(vec2 p) {
            float value = 0.0;
            float amplitude = 1.0;
            float frequency = 1.0;
            for (int i = 0; i < 5; i += 1) {
                value += noise2d(p * frequency) * amplitude;
                frequency *= 2.0;
                amplitude *= 0.5;
            }
            return value;
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 uv = vUv * uScale + uTime * uSpeed;
            float pink = pinkNoise(uv);
            float noise = pink - 0.5;
            color.rgb += noise * uAmount;
            gl_FragColor = color;
        }
    `
});
