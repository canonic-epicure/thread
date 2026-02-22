type SpiralVertexShaderOptions = {
    letterRotation: number
}

export function createSpiralVertexShader(options: SpiralVertexShaderOptions): string {
    return `
    attribute float aReadableT;
    attribute float aReadableDelta;
    attribute vec2 aGlyphUv;

    uniform float uPlaneHalf;
    uniform float uSpiralTurns;
    uniform float uLetterSize;
    uniform float uAngleOffset;
    uniform float uSpiralProgress;
    uniform float uCenterCutoffT;
    uniform float uBlend;
    uniform float uLetterCount;
    uniform float uRadiusScale;
    uniform float uVisibleStartT;
    uniform float uAlphaEdge;
    uniform float uAlphaCenter;

    varying vec2 vUv;
    varying vec2 vGlyphUv;
    varying float vEdgeAlpha;
    varying float vVisible;

    const float PI = 3.141592653589793;

    void main() {
        float readableRaw = aReadableT + uSpiralProgress;
        float tOriginal = mod(readableRaw, 1.0);
        float displacedIndex = aReadableT * uLetterCount + aReadableDelta;
        float tDisplaced = mod(displacedIndex / uLetterCount + uSpiralProgress, 1.0);
        float delta = tOriginal - tDisplaced;
        if (delta > 0.5) {
            delta -= 1.0;
        } else if (delta < -0.5) {
            delta += 1.0;
        }
        float t = mod(tDisplaced + delta * uBlend + 1.0, 1.0);
        if (t < uVisibleStartT || t > uCenterCutoffT) {
            vVisible = 0.0;
            vEdgeAlpha = 0.0;
            vUv = uv;
            vGlyphUv = aGlyphUv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 10000.0, 1.0);
            return;
        }

        vVisible = 1.0;
        float radius = (uPlaneHalf - t * uPlaneHalf) * uRadiusScale;
        float angle = -uSpiralTurns * 2.0 * PI * t + uAngleOffset;
        vec2 pos = vec2(cos(angle), sin(angle)) * radius;

        vec2 quad = position.xy * uLetterSize;
        float orient = angle + PI + ${options.letterRotation.toFixed(3)};
        vec2 up = vec2(cos(orient), sin(orient));
        vec2 right = vec2(up.y, -up.x);
        vec2 offset = right * quad.x + up * quad.y;

        vec3 finalPos = vec3(pos + offset, 0.01);

        float edgeT = clamp(length(pos) / uPlaneHalf, 0.0, 1.0);
        vEdgeAlpha = mix(uAlphaCenter, uAlphaEdge, edgeT);

        vUv = uv;
        vGlyphUv = aGlyphUv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
`
}

export function createSpiralFragmentShader(): string {
    return `
    uniform sampler2D uAtlas;
    uniform vec2 uAtlasGrid;
    uniform vec3 uLetterColor;

    varying vec2 vUv;
    varying vec2 vGlyphUv;
    varying float vEdgeAlpha;
    varying float vVisible;

    void main() {
        if (vVisible < 0.5) {
            discard;
        }

        float flippedRow = (uAtlasGrid.y - 1.0) - vGlyphUv.y;
        vec2 atlasUv = vec2(
            (vGlyphUv.x + vUv.x) / uAtlasGrid.x,
            (flippedRow + vUv.y) / uAtlasGrid.y
        );

        vec4 glyphSample = texture2D(uAtlas, atlasUv);
        float glyphAlpha = max(glyphSample.a, glyphSample.r);
        float alpha = glyphAlpha * vEdgeAlpha;

        if (alpha < 0.01) {
            discard;
        }

        gl_FragColor = vec4(uLetterColor, alpha);
    }
`
}
