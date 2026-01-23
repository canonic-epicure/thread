# Design Overview

This project renders a single Three.js scene with a text‑mapped sphere and a surrounding depressed plane. The experience is driven by animated text flow, inertia‑based interaction on the sphere, and a spiral text pattern on the plane. The system is designed so that the sphere appears to be covered in scrolling text, while the plane provides a large visual context with a central sink and a spiral of letters converging toward it.

## Core Goals
- Present a centered 3D sphere whose surface is covered by a rectangular grid of letters.
- Animate text on the sphere so it flows continuously without rotating the mesh itself.
- Provide a large, shallow plane around the sphere with a central depression (“sink”).
- Render a spiral of letters on the plane, moving along the spiral path toward the center.
- Allow interactive control over the sphere’s text flow with inertia and smooth return to auto‑scroll.
- Maintain clear visual separation between sphere text, plane text, and the plane surface.

## Scene Composition
### Camera
- Perspective camera positioned forward on the Z axis, aimed at the origin.
- Subtle camera drift/float and optional mouse‑based horizontal movement for a gentle motion effect.

### Lighting
- A soft ambient light combined with a directional light for overall readability.
- Lighting is kept simple to preserve text legibility and emphasize the surface shapes.

### Sphere
- A static sphere mesh (the geometry itself does not spin).
- The sphere uses a canvas‑generated texture containing:
  - A rectangular grid.
  - Letter columns drawn vertically in each grid cell.
  - Per‑column text offsets so columns differ but loop cleanly.
- The texture scrolls vertically, creating the illusion of letters moving upward along the sphere.
- The scroll speed has inertia:
  - When the user clicks and holds, the scroll decelerates toward zero.
  - Mouse drag produces velocity impulses; repeated drags add momentum.
  - On release, the scroll speed eases back to the auto‑scroll target.
  - This allows stacking impulses for a “push” effect and gradual return to baseline.

### Spiral Plane
- A large plane with a Gaussian‑style depression centered at the origin to mimic a sink.
- The plane surface is a mesh with higher segmentation so the depression is smooth.
- The plane material is dark by default, allowing text/lines to stand out.
- A dedicated overlay mesh is used to render the spiral letters:
  - The overlay uses a canvas texture updated every frame.
  - The overlay is separate from the base plane material so the text can be animated without altering the base surface.
- A spiral path is defined in polar space and the letters move along it from the edge toward the center.

## Spiral Text Behavior
### Text Source
- Spiral letters are sourced from a long repeating text string (`LONG_TEXT`).
- Characters are arranged along the spiral in sequence, with per‑letter displacement applied to the string order.

### Displacement Model
- Each character has two indices:
  - Original index (the true order in the text).
  - Displaced index (a shifted, randomized position in the string).
- These two indices define two positions on the spiral path.
- The system blends between those positions:
  - When the sphere is pressed and its scroll speed reaches near zero, after a delay the spiral letters move toward their original positions.
  - On release, letters smoothly return to displaced positions.
  - The transition is time‑based and reversible mid‑animation.

### Visual Flow
- Spiral progression advances continuously, so letters always move along the spiral.
- Alpha fades from transparent at the outer edge to fully opaque near the center.
- The spiral appears dense and continuous due to a high letter count and multiple spiral turns.

## Interaction Model
### Sphere Drag
- Only activates on direct click of the sphere (raycast hit).
- Holding the click reduces scroll speed to zero over a short time.
- Dragging applies instantaneous velocity impulses to the scroll speed.
- Releasing returns the scroll speed to auto‑scroll over a longer, smoother time.

### Spiral Reaction to Sphere State
- The spiral animation checks the sphere state:
  - If the sphere is held and its scroll speed is near zero, a delay begins.
  - After the delay, letters transition to their original (ordered) positions.
  - Releasing immediately begins the transition back to displaced positions.

## Materials and Color Strategy
- Base material parameters (roughness/metalness) are shared for consistency.
- Sphere and plane colors can be separated for contrast (e.g., light spiral letters on a dark plane).
- Spiral letters are rendered with a fixed color and alpha gradient for depth cues.

## Performance Considerations
- Canvas textures are high‑resolution and updated per frame.
- The spiral overlay uses a separate mesh to avoid re‑creating geometry.
- The sphere’s scrolling text is done purely via UV offset, which is efficient.

## Extensibility
- The sphere controller is isolated and can be reused or swapped without touching main rendering logic.
- The spiral plane is self‑contained and can be replaced with other patterns (grid, rings, etc.).
- Text source can be replaced by editing `text.ts`.
- Interaction thresholds and timings are controlled by dedicated constants for easy tuning.
