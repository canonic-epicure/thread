# Design Overview

This project renders a single Three.js WebGL scene with a text‑mapped sphere and a surrounding depressed plane. The experience is driven by animated text flow, inertia‑based interaction on the sphere, and a spiral of letters that flows toward a central sink. The system is designed so the sphere appears covered in scrolling text, while the plane provides a large context with a dense spiral of characters converging to the center. On top of the base scene, the renderer applies a post‑processing noise pass and exposes live controls through an inspector panel.

## Core Goals
- Present a centered 3D sphere whose surface is covered by a rectangular grid of letters.
- Animate text on the sphere so it flows continuously without rotating the mesh itself.
- Provide a large, shallow plane around the sphere with a central depression (“sink”).
- Render a spiral of letters on the plane, moving along the spiral path toward the center.
- Allow interactive control over the sphere’s text flow with inertia and smooth return to auto‑scroll.
- Keep the spiral letters anchored to the curved surface and oriented toward the center.
- Keep the scene tunable via an inspector panel (noise + colors).

## Scene Composition
### Camera
- Perspective camera positioned forward on the Z axis, aimed at the origin.
- Subtle vertical drift and mouse‑based horizontal movement for gentle parallax.

### Lighting
- Soft ambient light combined with a directional light for readability.
- Simple lighting to preserve text legibility and emphasize surface shape.

### Sphere
- The sphere is composed of two meshes:
  - Base mesh: solid `MeshStandardMaterial` whose color is adjustable by the inspector.
  - Text mesh: transparent `MeshStandardMaterial` that carries the letter texture and floats slightly above the base.
- The text texture is generated via a 2D canvas:
  - A rectangular grid is drawn across the texture.
  - Letter columns are drawn vertically in each grid cell.
  - Per‑column offsets are used so columns differ but loop cleanly.
- The texture scrolls vertically via UV offset, creating the illusion of letters moving upward.
- A designated column receives a glow pass on the canvas (shadow blur + additive blend), so the “central” column reads as emphasized text.
- Scroll speed has inertia:
  - Pointer down brings base scroll toward zero.
  - Dragging applies velocity impulses.
  - On release, speed eases back to auto‑scroll.

### Spiral Plane
- A large plane with a Gaussian‑style depression centered at the origin.
- The base plane mesh is highly segmented for a smooth sink.
- The plane material uses an alpha map so the edges fade out, reducing the visible square boundary.
- The plane renders only the front side; the back face is culled to avoid seeing through the plane.

### Spiral Letters
- Spiral letters are rendered as instanced quads with a custom `ShaderMaterial`:
  - The shader computes spiral position, alpha fade, and orientation on the GPU.
  - Each quad is oriented toward the center and aligned to the curved surface normal.
- A glyph atlas is built once on a canvas and used for all instances.
- Only glyph indices update when slots wrap (cheap per frame).

### Plane Particles
- Short “streak” particles move across the plane surface:
  - Each particle is a tiny ribbon quad rendered via instancing.
  - A head/tail segment is updated per frame to form a short afterglow.
  - Particles respawn when they expire or drift outside the bounds.
- Particle positions follow the depressed plane height so they hug the surface.

### Plane Lens Distortion
- A set of moving “lens” particles distort the spiral letter positions:
  - Each lens has a position, radius, and strength.
  - The spiral vertex shader pushes letter positions radially when they fall inside a lens.
  - This produces a magnification / push‑pull effect on the letters only.
- Lens visuals are rendered as instanced quads:
  - A ring + core glow shader makes the lens areas visible.
  - These render on top of the plane (no depth test) so they remain readable.

## Spiral Text Behavior
### Text Source and Generator
- Spiral letters are sourced from a long repeating text string (`LONG_TEXT`).
- A generator yields characters sequentially; slots are refilled as letters wrap from the center to the edge.

### Displacement Model
- Each slot has two indices:
  - Original index (true order in the text stream).
  - Displaced index (randomized by a Gaussian offset).
- These indices define two positions on the spiral.
- The system blends between those positions:
  - While the pointer is held, after a delay the spiral transitions toward ordered positions.
  - On release, it transitions back to displaced positions.
  - Blending uses smoothstep easing (slow start, acceleration, slight slowdown near the end).

### Visual Flow
- Spiral progression advances continuously, so letters always move along the spiral.
- Alpha fades from transparent at the edge to opaque near the center.
- A high letter count and many spiral turns create density and continuity.

## Interaction Model
### Sphere Drag
- Dragging only activates on raycast hit of the sphere.
- Holding the click reduces scroll speed toward zero.
- Dragging applies instantaneous velocity impulses.
- Releasing returns scroll speed to auto‑scroll.

### Spiral Reaction to Sphere State
- If the pointer is held, a delay begins; after the delay the spiral transitions to ordered positions.
- On release, the spiral transitions back to displaced positions with smooth easing.

## Post‑Processing
- Rendering uses `EffectComposer` with:
  - A base `RenderPass`.
  - A custom noise `ShaderPass`.
- The noise shader currently uses a pink‑noise style FBM (1/f weighting).
- Noise amount, scale, and speed are exposed in the inspector.

## Inspector / Live Controls
- Uses `lil-gui` to expose real‑time tuning.
- Current controls:
  - Noise amount, scale, speed.
  - Sphere color.
  - Sphere letter color (and grid color).
  - Spiral plane color.
  - Spiral letter color.

## Music / SoundCloud Behavior
- Sound is provided by a hidden SoundCloud widget iframe created in `sound.ts`.
- The iframe is kept offscreen/hidden via CSS, while a single toggle button is shown.
- The toggle button is the only visible UI element for audio control.
- Clicking the button toggles play/pause using the SoundCloud Widget API.
- The button icon switches between "sound off" and "sound on" states; `aria-pressed`
  and `aria-label` update accordingly for accessibility.
- Autoplay is disabled in the iframe URL; playback begins only after user action.
- When the widget first starts playing, a one‑time seek is applied if `startMs > 0`.
- The seek is bound on the first `PLAY` event to avoid fighting autoplay restrictions.
- If the widget API fails to load, the scene still renders; the audio control becomes inert.

## Materials and Color Strategy
- Base material parameters (roughness/metalness) are shared for consistency.
- Sphere base color is independent from the letter texture.
- Spiral plane and spiral letters have independent colors for contrast.

## Performance Considerations
- Sphere text is handled by UV offset (cheap per frame).
- Spiral letters are instanced on the GPU; only per‑slot glyph indices update when wrapping.
- Plane particles and lens visuals are instanced and update small attribute buffers per frame.
- Post‑processing adds a single full‑screen pass; noise complexity is intentionally low.

## Extensibility
- The sphere controller is isolated and can be reused or swapped without touching main rendering logic.
- The spiral plane is self‑contained and can be replaced with other patterns.
- Text source can be replaced by editing `text.ts`.
- Interaction thresholds and timings are controlled by constants in `spiral.ts` and `sphere.ts`.
- The inspector can be extended by adding new uniforms or controller setters and wiring them to GUI controls.
