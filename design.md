# Design Overview

This project renders a single Three.js WebGL scene with a text‑mapped sphere and a surrounding depressed plane. The experience is driven by animated text flow, inertia‑based interaction on the sphere, and a spiral of letters that flows toward a central sink. The system is designed so the sphere appears covered in scrolling text, while the plane provides a large context with a dense spiral of characters converging to the center.

## Core Goals
- Present a centered 3D sphere whose surface is covered by a rectangular grid of letters.
- Animate text on the sphere so it flows continuously without rotating the mesh itself.
- Provide a large, shallow plane around the sphere with a central depression (“sink”).
- Render a spiral of letters on the plane, moving along the spiral path toward the center.
- Allow interactive control over the sphere’s text flow with inertia and smooth return to auto‑scroll.
- Keep the spiral letters anchored to the curved surface and oriented toward the center.

## Scene Composition
### Camera
- Perspective camera positioned forward on the Z axis, aimed at the origin.
- Subtle vertical drift and mouse‑based horizontal movement for gentle parallax.

### Lighting
- Soft ambient light combined with a directional light for readability.
- Simple lighting to preserve text legibility and emphasize surface shape.

### Sphere
- Static sphere mesh (geometry does not spin).
- A canvas‑generated texture provides:
  - A rectangular grid.
  - Letter columns drawn vertically in each grid cell.
  - Per‑column text offsets so columns differ but loop cleanly.
- The texture scrolls vertically via UV offset, creating the illusion of letters moving upward.
- Scroll speed has inertia:
  - Pointer down brings base scroll toward zero.
  - Dragging applies velocity impulses.
  - On release, speed eases back to auto‑scroll.

### Spiral Plane
- A large plane with a Gaussian‑style depression centered at the origin.
- The base plane mesh is highly segmented for a smooth sink.
- The plane material is opaque and dark so spiral letters stand out.
- Spiral letters are rendered as instanced quads with a custom `ShaderMaterial`:
  - The shader computes spiral position, alpha fade, and orientation on the GPU.
  - The letter quads are oriented toward the center and aligned to the curved surface.

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

## Materials and Color Strategy
- Base material parameters (roughness/metalness) are shared for consistency.
- Sphere and plane colors are separated for contrast (light letters on dark plane).
- Spiral letters use a fixed color and alpha gradient for depth cues.

## Performance Considerations
- Sphere text is handled by UV offset (cheap per frame).
- Spiral letters are instanced on the GPU; only per‑slot glyph indices update when wrapping.
- The spiral texture is a single glyph atlas texture reused by all instances.

## Extensibility
- The sphere controller is isolated and can be reused or swapped without touching main rendering logic.
- The spiral plane is self‑contained and can be replaced with other patterns.
- Text source can be replaced by editing `text.ts`.
- Interaction thresholds and timings are controlled by constants in `spiral.ts` and `sphere.ts`.
