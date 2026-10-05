---
name: "Веркуп — студия вывесок"
description: "Визуальная система существующего публичного конструктора вывесок."
colors:
  accent: "#e45c22"
  accent-hover: "#c64a17"
  action: "#c54b1c"
  action-hover: "#ae3e14"
  accent-soft: "#fff1e9"
  ink: "#272822"
  muted: "#74756d"
  control-muted: "#626857"
  border: "#e5e5dd"
  paper: "#ffffff"
  shell: "#f6f6f1"
  workspace: "#282c28"
  workspace-secondary: "#30352e"
  selected-view: "#e5ebda"
typography:
  headline:
    fontFamily: '"Manrope", "Segoe UI", Arial, sans-serif'
    fontSize: "clamp(26px, 2.4vw, 35px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-1.15px"
  body:
    fontFamily: '"Manrope", "Segoe UI", Arial, sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  control-title:
    fontSize: "17px"
    fontWeight: 580
    letterSpacing: "-0.35px"
  label:
    fontSize: "12px"
    fontWeight: 450
    lineHeight: 1.35
  price:
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-1px"
rounded:
  badge: "4px"
  field: "5px"
  button: "6px"
  cart: "8px"
  controls: "9px"
  workspace: "10px"
spacing:
  compact: "8px"
  field: "12px"
  mobile-gutter: "16px"
  workspace-gap: "22px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "9px 14px"
    height: "40px"
  button-cart:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "13px 20px"
    height: "49px"
  button-cart-hover:
    backgroundColor: "{colors.action-hover}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "#33362c"
    rounded: "{rounded.field}"
    padding: "10px 12px"
    height: "44px"
  controls:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.controls}"
  cart-count:
    backgroundColor: "#e6ecd9"
    textColor: "#566644"
    rounded: "{rounded.badge}"
    padding: "0 5px"
    height: "20px"
---

# Design System: Веркуп — студия вывесок

## Overview

The current studio uses a cream page, white controls, olive neutrals, and orange actions. Its dark preview is the visual center: lettering, material depth, dimensions, and illumination carry the expression while the interface stays compact and practical. Preserve the existing Веркуп mark and Russian interface.

This records the built public studio, not a new identity or a rule for unrelated CRM screens. Ground truth is `src/sign-studio.css`, `src/sign-studio-commerce.css`, `src/sign-cart.css`, `src/sign-scene-3d.css`, and the matching components. Current captures are in `.impeccable/review/` at desktop, mobile, and the actual 489px viewport.

**Key Characteristics:**
- Cream and olive working surfaces with restrained orange emphasis.
- Dark preview beside a white, sectioned control panel.
- Small labels, thin dividers, and tabular dimensions and prices.

## Colors

### Primary

`accent` marks selected tabs, inputs, checkboxes, and options. The darker `action` fills export and basket buttons. Their hover colors are separate; do not collapse the existing specificity into one orange.

### Neutral

`shell` surrounds `paper` panels. `ink` is the main text; `muted` serves general metadata and `control-muted` serves the more legible field notes. `border` divides the light surfaces. The olive charcoal `workspace` and `workspace-secondary` frame the preview; `selected-view` makes the current 2D/3D choice visible.

The scene's day/night materials and user-selected sign colors belong to the visualization, not the interface palette. Approval messages use warm tinted surfaces; ordinary frame guidance uses pale olive surfaces.

## Typography

Manrope is bundled locally and supplies the interface. Roboto Condensed is also bundled for sign lettering; other lettering choices may depend on the device. Keep the UI font separate from the selected sign font.

The page headline uses the fluid `headline` role and becomes (28px) on mobile. Control headings are quieter than the headline. Field labels use the `label` role; notes and toolbar text generally range from (10–13px). Prices and measurements use tabular numerals; the main price becomes (29px) on mobile. Numeric fields are (15px) on desktop and (16px) on mobile.

## Layout

Desktop has a flexible preview and summary column beside a (360px) controls column, separated by the `workspace-gap`. The shell gutter is `clamp(20px, 3.3vw, 56px)`. From (768–1100px), the controls narrow to (330px), gutters become (24px), and the purchase action stacks below its price.

At (767px) and below, use one column with the `mobile-gutter`: header actions form a two-by-two grid, then product tabs, preview, controls, project summary, and purchase action. The mobile 2D workspace is (365px) tall and may stick at the top; the 3D workspace is (445px) tall and remains in normal flow so touch rotation does not trap scrolling. The basket reflows again at (860px) and (560px), keeping quantity, price, and removal visible.

## Elevation & Depth

Panels are primarily separated by borders and tonal changes. The preview has a shallow shadow (`0 12px 25px -20px rgba(18, 26, 17, 0.45)`); controls have an even quieter shadow (`0 3px 7px -6px rgba(28, 35, 22, 0.22)`). Material shadows and glow belong to the sign scene. Keep these separate from UI elevation.

## Shapes

Use the existing small rectangular radii: fields and option tiles use `field`, buttons use `button`, and larger surfaces use `cart`, `controls`, or `workspace`. Tabs are flat with an orange (2px) underline. Color swatches stay square with a selection ring and a check mark. Avoid introducing pill-shaped navigation into this surface.

## Components

- **Actions:** outlined neutral controls accompany solid orange export and basket actions. The basket action spans the mobile width and has a (50px) minimum height.
- **Tabs and options:** product and control tabs use an underline; option tiles use an orange border and pale orange fill. View switches use a pale olive selected segment inside the dark toolbar.
- **Fields:** thin border, white fill, modest radius, and a border shift on focus. Numeric width and height stay in a two-column group. Mobile fields have a (46px) minimum height.
- **Focus and motion:** the common focus outline is (3px), orange at 55% opacity, offset (3px). Buttons use (140ms) color transitions and a (120ms) press transform. Reduced motion disables the press transform and shortens transitions. The 3D viewport also has its own inset olive focus ring.
- **Preview:** separate day/night controls from 2D/3D selection. Dimensions, front view, reset, loading, and failure feedback remain attached to the canvas. In 3D, pointer or touch rotation and keyboard controls support inspection; glow changes with the selected lighting mode.
- **Summary and basket:** project facts use a quiet grid beneath the preview. Pricing shows a large amount with its formula and scope notes. Basket rows use thumbnails, compact quantity controls, and explicit approval text; the local-storage status stays visible. Functional thresholds and pricing rules are documented in `SIGN-STUDIO.md`.

## Do's and Don'ts

### Do:
- **Do** preserve the cream, olive, orange, and Manrope identity when extending the studio.
- **Do** keep controls readable around the preview and retain units, selection states, focus feedback, and approval notes.
- **Do** check the desktop layout and narrow mobile layout together after changing the shared surface.

### Don't:
- **Don't** turn scene glow or user-selected material colors into decorative UI effects.
- **Don't** replace the compact borders, small radii, and underlined tabs with a new component style.
- **Don't** label a locally saved basket as a submitted order or visually fold unpriced work into the calculated total.
