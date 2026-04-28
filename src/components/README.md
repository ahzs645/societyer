# Component Taxonomy

Societyer keeps a small local component set instead of importing Twenty UI wholesale. New reusable UI should follow this taxonomy so product code stays easy to scan:

- `display`: read-only presentation such as badges, chips, icons, summaries, timelines, and empty states.
- `feedback`: loaders, progress, toast surfaces, and inline validation feedback.
- `input`: buttons, text fields, selects, pickers, toggles, upload controls, and editor controls.
- `layout`: modals, drawers, panels, tabs, resize handles, split views, and page scaffolding.
- `navigation`: sidebar, command palette, breadcrumbs, menus, and route links.
- `theme`: token helpers and theme-specific utilities.

Existing files can move into these folders gradually when they are touched for feature work. Avoid a mechanical migration that only changes imports.
