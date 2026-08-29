# Reactiive motion reference catalog

Snapshot: 2026-08-29. Semantic index of **123 demos** from `enzomanuelmangano/demos` for Kafedra Planner retrieval. This is an original engineering index, **not a redistributed source-code library**. Upstream: https://github.com/enzomanuelmangano/demos and https://reactiive.io/demos.

`semantic` means the catalog identifies a motion family/idea; inspect current upstream `src/animations/<demo>/` before claiming exact timing/easing/spring parameters. `exact` examples below were source-verified during catalog preparation. Kafedra production defaults are in `docs/MOTION_DESIGN.md`.

## `navigation_tabs_bars` — Навигация, вкладки и панели

Active-state continuity: move one indicator/anchor between targets; use restrained opacity/material only as secondary cue.

- `action-tray` → `navigation_tabs_bars`
- `blurred-bottom-bar` → `navigation_tabs_bars`
- `bottom-bar-skia` → `navigation_tabs_bars`
- `dynamic-blur-tabs` → `navigation_tabs_bars`
- `dynamic-tab-indicator` → `navigation_tabs_bars`
- `exclusion-tabs` → `navigation_tabs_bars`
- `floating-bottom-bar` → `navigation_tabs_bars`
- `fluid-tab-interaction` → `navigation_tabs_bars`
- `smooth-dropdown` → `navigation_tabs_bars`
- `tab-navigation` → `navigation_tabs_bars`
- `twitter-tab-bar` → `navigation_tabs_bars`

## `overlays_sheets_modals` — Bottom sheets, drawer, modal, toast и overlays

Temporary layer preserves context; enter from source/edge, coordinate backdrop and geometry, keep dismissal obvious.

- `alert-drawer` → `overlays_sheets_modals`
- `clerk-toast` → `overlays_sheets_modals`
- `draggable-panel` → `overlays_sheets_modals`
- `floating-modal` → `overlays_sheets_modals`
- `popup-handler` → `overlays_sheets_modals`
- `scrollable-bottom-sheet` → `overlays_sheets_modals`
- `skia-bottom-sheet` → `overlays_sheets_modals`
- `stacked-bottom-sheet` → `overlays_sheets_modals`
- `stacked-modals` → `overlays_sheets_modals`
- `toast` → `overlays_sheets_modals`

## `direct_manipulation` — Drag, swipe, reveal и непосредственное управление

1:1 pointer mapping during gesture; velocity-aware snap/spring only after release; thresholds visible before commit.

- `image-cropper` → `direct_manipulation`
- `magnet-spring` → `direct_manipulation`
- `shake-to-delete` → `direct_manipulation`
- `slide-to-reveal` → `direct_manipulation`
- `swipe-cards` → `direct_manipulation`
- `twodos-slide` → `direct_manipulation`

## `sliders_pickers_inputs` — Sliders, pickers и ввод

Continuous value follows input directly; labels/markers remain readable; haptics only at semantic detents.

- `airbnb-slider` → `sliders_pickers_inputs`
- `balance-slider` → `sliders_pickers_inputs`
- `clock-time-picker` → `sliders_pickers_inputs`
- `cuberto-slider` → `sliders_pickers_inputs`
- `duration-slider` → `sliders_pickers_inputs`
- `family-number-input` → `sliders_pickers_inputs`
- `fluid-slider` → `sliders_pickers_inputs`
- `mobile-input` → `sliders_pickers_inputs`
- `prequel-slider` → `sliders_pickers_inputs`
- `skia-color-picker` → `sliders_pickers_inputs`
- `verification-code` → `sliders_pickers_inputs`
- `verification-code-face` → `sliders_pickers_inputs`
- `wheel-picker` → `sliders_pickers_inputs`

## `lists_grids_layout` — Списки, сетки, layout/reorder

Preserve spatial memory while items enter/leave/reorder; active object is visually anchored.

- `animated-grid-list` → `lists_grids_layout`
- `animated-indicator-list` → `lists_grids_layout`
- `calendar-days` → `lists_grids_layout`
- `drag-to-sort` → `lists_grids_layout`
- `email-demo` → `lists_grids_layout`
- `imessage-stack` → `lists_grids_layout`
- `ios-home-bouncy` → `lists_grids_layout`
- `ios-home-grid` → `lists_grids_layout`
- `selectable-grid-list` → `lists_grids_layout`
- `stacked-list` → `lists_grids_layout`

## `carousel_scroll_depth` — Carousel, scroll и depth transitions

Scroll progress maps continuously to position/scale/depth; avoid theatrical 3D in dense operational lists.

- `3d-scroll-transition` → `carousel_scroll_depth`
- `blurred-scroll` → `carousel_scroll_depth`
- `circular-carousel` → `carousel_scroll_depth`
- `color-carousel` → `carousel_scroll_depth`
- `coverflow-carousel` → `carousel_scroll_depth`
- `infinite-carousel` → `carousel_scroll_depth`
- `scrollable-shapes` → `carousel_scroll_depth`
- `stacked-carousel` → `carousel_scroll_depth`

## `microinteractions_feedback` — Кнопки, feedback, status и microinteractions

Short local feedback for press/loading/success/error; no celebratory motion for routine administrative work.

- `add-to-cart` → `microinteractions_feedback`
- `checkbox-interactions` → `microinteractions_feedback`
- `delete-button` → `microinteractions_feedback`
- `geometry-button` → `microinteractions_feedback`
- `loading-button` → `microinteractions_feedback`
- `online-offline` → `microinteractions_feedback`
- `particles-button` → `microinteractions_feedback`
- `record-button` → `microinteractions_feedback`
- `split-button` → `microinteractions_feedback`
- `staggered-card-number` → `microinteractions_feedback`

## `morph_shared_reveal` — Morph, shared transition, clip/reveal

One progress connects the same object across states through bounds/radius/clip/type; crossfade is secondary.

- `animated-clip-box` → `morph_shared_reveal`
- `composable-text` → `morph_shared_reveal`
- `dot-sheet` → `morph_shared_reveal`
- `gl-transitions` → `morph_shared_reveal`
- `interaction-appearance` → `morph_shared_reveal`
- `shared-transition` → `morph_shared_reveal`
- `telegram-theme-switch` → `morph_shared_reveal`
- `theme-canvas-animation` → `morph_shared_reveal`

## `glass_blur_material_light` — Blur, glass, reflection, light и material effects

Material/depth cue only; preserve contrast and profile blur/reflection; never replace structure with glass.

- `blur-cards` → `glass_blur_material_light`
- `blur-circles` → `glass_blur_material_light`
- `card-shader-reflections` → `glass_blur_material_light`
- `fractal-glass` → `glass_blur_material_light`
- `light-on-painting` → `glass_blur_material_light`
- `liquid-glass-playground` → `glass_blur_material_light`
- `motion-blur` → `glass_blur_material_light`
- `threads-holo-ticket` → `glass_blur_material_light`

## `procedural_shader_particles` — Skia/WebGPU shaders, procedural geometry и particles

Generative/Skia/WebGPU reference; use only when functional value justifies GPU cost and provide static fallback.

- `atlas-button` → `procedural_shader_particles`
- `bezier-curve-outline` → `procedural_shader_particles`
- `fibonacci-shader` → `procedural_shader_particles`
- `fibonacci-shader-grid` → `procedural_shader_particles`
- `grid-visualizer` → `procedural_shader_particles`
- `metaball` → `procedural_shader_particles`
- `sphere-waves` → `procedural_shader_particles`
- `spiral` → `procedural_shader_particles`

## `data_viz_sensors` — Графики, данные и sensor-driven motion

Animate data without changing its quantitative truth; axes/labels remain stable; sensor input needs smoothing and latency control.

- `animated-count-text` → `data_viz_sensors`
- `fourier-visualizer` → `data_viz_sensors`
- `github-contributions` → `data_viz_sensors`
- `github-terrain` → `data_viz_sensors`
- `linear-sensors` → `data_viz_sensors`
- `miles-bar-chart` → `data_viz_sensors`
- `pomodoro-timer` → `data_viz_sensors`
- `radar-chart` → `data_viz_sensors`
- `scroll-progress` → `data_viz_sensors`
- `steddy-graph-interaction` → `data_viz_sensors`
- `steps` → `data_viz_sensors`

## `spatial_3d` — 3D, perspective, parallax и spatial UI

Perspective/parallax/folding/flip for real spatial relationship; avoid when 2D continuity communicates better.

- `airbnb-flip-interaction` → `spatial_3d`
- `animated-3d-parallax` → `spatial_3d`
- `atlas-sphere` → `spatial_3d`
- `paper-folding` → `spatial_3d`

## `media_storytelling` — Медиа, storytelling и контентные переходы

Staged content/player/story transitions; prioritize narrative continuity over operational density.

- `art-gallery` → `media_storytelling`
- `audio-player` → `media_storytelling`
- `everybody-can-cook` → `media_storytelling`
- `expandable-mini-player` → `media_storytelling`
- `github-onboarding` → `media_storytelling`
- `story-list` → `media_storytelling`
- `the-little-prince` → `media_storytelling`
- `time-machine` → `media_storytelling`

## `qr_generative_identity` — QR и генеративная айдентика

Decorative generation/reveal around QR while preserving machine readability.

- `cherry-blossom-qrcode` → `qr_generative_identity`
- `empty-qrcode` → `qr_generative_identity`
- `notion-qrcode` → `qr_generative_identity`
- `qrcode` → `qr_generative_identity`

## `games_experiments` — Игры и экспериментальные интерактивные сцены

Low-latency interactive loops useful as gesture/state references, not default product styling.

- `chessboard` → `games_experiments`
- `mnist` → `games_experiments`
- `snake` → `games_experiments`
- `sudoku` → `games_experiments`

## Source-verified exemplars

- `airbnb-flip-interaction`: spring `mass=1.2`, `stiffness=80`, `damping=12`, `velocity=0.3`; blur `0→10→20→10→0`; enter `400 ms`, exit `250 ms`.
- `dot-sheet`: one progress morphs bounds/radius/rotation/type; rotation `-4°→0°`, radius `16→32`, type `14→24`; focus/blur spring `duration=800 ms`, `dampingRatio=1`.
- `magnet-spring`: velocity-aware release spring `mass=0.4`, `damping=15`, `stiffness=120`; active scale `1.2`; direct pointer-follow during drag.
- `everybody-can-cook`: second staggered text line starts with `280 ms` delay.
- `time-machine`: spring `mass=0.2`, `damping=15`, `stiffness=300`; horizontal offset selects historical state.

## Licensing boundary

The upstream repository uses a custom license. Store only original classifications, engineering descriptions, measured parameters and links/source identifiers here. Do not copy upstream component source into this catalog, redistribute it, or turn this repository into a competing animation library.
