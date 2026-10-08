---
name: "Маленький заезд"
description: "TRX-inspired RC pickup with Город Свет livery and physical props, standalone and in the sign configurator's full-width courtyard."
colors:
  primary: "#073c2d"
  activity: "#16803d"
  page: "#f6f8f5"
  surface: "#ffffff"
  muted: "#62766c"
  line: "#e1e8e2"
  segmented: "#f0f4ef"
  selected-camera: "#eaf1e6"
  stage: "#e8ede6"
  ground: "#c3d3bf"
  car-honey: "#e8bc45"
  car-forest: "#3a8667"
  car-coral: "#dc705b"
  spring-orange: "#ec7842"
typography:
  display:
    fontFamily: '"RcManrope", "Manrope", "Segoe UI", sans-serif'
    fontSize: "clamp(25px, 2.6vw, 35px)"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-.035em"
  body:
    fontFamily: '"RcManrope", "Manrope", "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  control:
    fontFamily: '"RcManrope", "Manrope", "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.2
  speed:
    fontFamily: '"RcManrope", "Manrope", "Segoe UI", sans-serif'
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-.04em"
rounded:
  shell: "16px"
  segmented: "9px"
  control: "7px"
  action: "8px"
  overlay: "12px"
  circle: "50%"
components:
  mode-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  camera-selected:
    backgroundColor: "{colors.selected-camera}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  resume:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.overlay}"
    padding: "15px 24px"
---

# Design System: Маленький заезд

## Overview

This is an **EXPERIENCE** surface: a small physical RC pickup on a tabletop course or in the sign building's courtyard. The 3D scene occupies the flexible middle of the viewport; the page title, brand mark and two control rows stay compact. The default honey body, wide TRX-inspired silhouette, dark off-road tyres, open pickup bed, exposed suspension and spring antenna supply the visual character. Город Свет livery is attached to both doors, the hood and the tailgate as mesh decals.

This file describes `/rc-playground/`, its embedded variant, and the native game inside the sign configurator. The root [`DESIGN.md`](../DESIGN.md) remains the brand authority. The game inherits the brand green, pale page background and locally served Manrope. `world.ts` assembles the shared scene; `trxTruck.ts` owns the pickup geometry, `physics.ts` the vehicle simulation and `propsPhysics.ts` the Cannon ES rigid bodies. `terrainSurface.ts` supplies the reusable course description. `RcGame.tsx`, `rc-game.css` and `game.ts` provide the standalone surface; `facadeGame.ts`, `FacadeRcControls.tsx` and `facade-rc-controls.css` provide the configurator surface. Integration details live in [`README.md`](README.md).

## Colors

### Primary

- **Brand green:** primary text, selected driving mode, resume and retry actions.
- **Activity green:** keyboard focus, active state dot, cursor target and the next timed gate.

### Secondary

- **Honey / forest / coral:** the three car-body choices; honey is the initial state. These colors belong to the toy and its swatches.
- **Spring orange:** visible coiled springs, distinct from the silver piston and control arms.

### Neutral

- **Pale page / white surface:** page backdrop and the restrained shell/control rows.
- **Muted / line / segmented / selected camera:** supporting text, separators and control-state layering.
- **Stage / ground:** pale fallback stage and the green physical course. Scene lighting and materials determine the rendered appearance.

## Typography

One locally served variable Manrope family is registered as `RcManrope` from `/fonts/Manrope-Variable.ttf` (weights 200–800, `font-display: swap`). The page title is the only large editorial text. Controls use compact semibold labels; guidance is smaller and muted.

The speed and timing values use tabular numerals. Time is displayed to tenths of a second. The speed readout reduces to 32px on narrow screens; the title reduces to 27px at 760px and 24px at 480px. Avoid expanding the header into a separate hero.

## Layout

The standalone page is a column at `100dvh`, with a minimum height of 680px and minimum width of 280px. Desktop padding is `24px 28px 16px`, with an 18px gap. The shell flexes to fill the remaining space. Its toolbar is at least 62px high, the settings row 66px, and the stage 390px. The canvas fills the stage absolutely.

- **At 1700px and wider:** horizontal page padding becomes 42px.
- **At 760px and below:** page minimum height becomes 620px; padding and gaps reduce, reset/help text and the secondary footer copy disappear.
- **At 480px and below:** shell corners become 12px, the stage minimum is 360px, pause and settings labels recede, and the driving hint moves above the bottom HUDs. The lap-count HUD is hidden. The 91px settings row wraps, giving all four camera buttons their own full-width row.
- **At 360px and below:** control padding and type shrink further to fit the same rows.
- **With a coarse pointer:** guidance switches to touch language; the swatches enlarge to 27px, with the 360px layout overriding them to 23px.

Trial telemetry sits at the upper left, speed at the lower left and four suspension bars at the lower right. These overlays do not intercept pointer input. The centered driving hint appears only while the car is at rest.

The `?embed=1` / `embedded` variant removes the page header and footer, page padding, shell border and shell radius. It retains the controls, HUD and help. Its component minimum height is 410px and its stage minimum is 280px; the standalone embedded entry fills `100dvh`. All interface styling is scoped under `rc-` classes, apart from the explicitly opted-in `body.rc-standalone` rules and font registration.

### At the sign's building

The configurator displays a courtyard across the complete width of its current front wall. `facadePlacement.ts` derives its position and width from the wall and pavement in the facade's local coordinates, including corner-building parts. One game unit is 200 mm; the toy retains its physical scale when the sign or facade placement changes. The new apron extends 4400 mm in front of the existing pavement. Its rear driving boundary reaches the shop frontage and connects the pavement, three entrance steps and threshold into one driveable surface. The added ground leaves the existing staircase visible. Planters and canopy columns remain fixed collision obstacles.

The resting preview has one compact **Поиграть с машинкой** action. Starting a game expands the existing 3D canvas to the full viewport, giving mouse and touch input enough room without creating another renderer. The white top bar contains **К вывеске**, pause and reset; telemetry sits below it. The bottom controls select **Свободно / На время** and **Площадка / Машинка / Сзади**, with pointer-specific guidance. These controls are scoped under `facade-rc-` classes, and interactive targets are at least 44px. The responsive layout keeps controls within the canvas at narrow widths.

**Площадка** frames the courtyard; **Машинка** follows the car more closely; **Сзади** looks forward from a lower position behind the pickup. The building, sign and selected day/night lighting remain in the same scene. Exit or Escape restores the sign preview's camera and scale. The normal sign-view controls return with it. Course geometry remains visible while inactive, but vehicle and prop physics steps run only during an active, unpaused game. Hidden or unfocused views clear held driving input. Switching to 2D removes the 3D game with its scene.

## Elevation & Depth

The interface uses white surfaces, pale control fills and thin separators. Only the open help panel and centered resume action carry CSS shadows. The playable scene provides most depth: rounded solid geometry, soft contact shadows, warm key light, cool fill light and restrained metallic reflections. The standalone course is a low slab with a height field, ramps and a rumble strip; the facade course follows its real pavement and stairs. Both contain printed surface marks and 25 loose physical props: four cones, nine tyres in three piles and twelve gate bollards.

## Shapes

The shell and floating panel have gently rounded corners. Buttons use smaller radii, color swatches are circles, and suspension telemetry uses four narrow rounded tracks. The pickup has a four-door crew cab, sculpted wheel openings, wide dark fenders, a hood scoop and vents, outlined headlights, recovery hooks and an open ribbed bed. Split-spoke rims and three rows of instanced tread blocks give its wheels an off-road silhouette. Preserve these proportions and the attached brand decals when changing materials or settings.

## Components

### Controls and overlays

The driving modes share a pale segmented container with a dark selected button. Camera selection is lighter and has no filled outer container. Pause, reset and help remain quiet icon/text actions. Swatches indicate selection through an outer outline and white center dot, as well as color. Buttons have a 1px pressed displacement, a visible green focus outline and disabled opacity of 0.45. Color/background transitions take 150ms; the suspension bars interpolate over 100ms. Reduced-motion preference removes CSS transitions.

Help opens above the settings row as a small white panel. Pause places a translucent veil over the existing scene and a centered resume action. Loading and WebGL failure states replace the stage with centered text; failure includes a retry button.

### Tabletop car

Holding the mouse or a finger points the car toward a ground target. A green ring follows the target; a faint dashed line appears during pointer driving. Releasing input leaves visible coasting. Body pitch, roll and vertical motion, four wheel contacts, the orange springs with metal arms, and the roof-mounted segmented antenna respond to the simulation. The wheel track is 1.16 scene units so the suspension assemblies remain exposed.

The standalone surface has four cameras. **Полигон** frames the course; **Следом** follows from above and behind; **Сзади** uses a lower rear view aimed forward along the vehicle's heading; **Детали** uses a close three-quarter view to expose the pickup, livery and suspension. Camera positions blend smoothly, and can be changed while paused. The renderer caps pixel ratio at 1.75.

### Loose props and contact surfaces

Each cone, tyre and bollard is an independent Cannon ES rigid body with mass, gravity, angular inertia and contact friction. A collision can slide, spin or tip a prop; every tyre can separate from its pile and roll. The annular tyre collision shape keeps its central opening. Props collide with one another, the car, terrain and fixed architecture. The vehicle retains its custom four-contact suspension solver: a kinematic chassis collider passes its motion into Cannon, and solved opposite contact impulses feed recoil back into the vehicle. The vehicle body does not use the prop rigid-body solver and does not overturn or deform.

The car and props use the same sampled terrain and fixed 120 Hz step. In the facade courtyard, that terrain includes the actual staircase treads and entrance threshold. Pausing stops both simulations. Reset restores the vehicle and every prop's original pose and clears prop linear and angular momentum, while retaining the best lap time.

**Свободный заезд** keeps the course available without timing telemetry. **На время** adds the timer, gate progress and available record/lap values; the next of six gates is highlighted. Best time persists locally. These are game states, not separate page layouts.

## Do's and Don'ts

- **Do** keep the scene as the flexible dominant area and retain the compact control rows.
- **Do** retain the visible wheel/suspension/antenna response and distinguish the active gate and cursor target with activity green.
- **Do** keep keyboard focus visible and control selection represented beyond color alone.
- **Do** scope future game styling to the RC surface and use the documented embedded boundary.
- **Don't** transfer this game's tabletop composition or HUD into the global brand system.
- **Don't** introduce configurator dependencies into the standalone game entry or the shared framework-free `world.ts` module.
- **Don't** add a second renderer or iframe to the configurator's native course; preserve the shared scene and the return to the sign camera.
