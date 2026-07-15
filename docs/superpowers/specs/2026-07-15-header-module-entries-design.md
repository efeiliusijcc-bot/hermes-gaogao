# Header Module Entries Design

## Goal

Replace the centered collapsible workspace switcher with four ordinary module entries positioned directly after the left-side product title.

## Scope

- Keep the existing module keys, permission filtering, active workspace calculation, and `switch-workspace` event contract.
- Render the visible module entries as a permanently visible horizontal navigation row.
- Remove the "Current module" trigger, hover expansion, delayed close, outside-click close, and Escape-close behavior that exist only for the collapsible workspace switcher.
- Leave report, QA, Daily Awareness, Draft Assistant, authentication, and authorization behavior unchanged.

## Layout

- The left side of the header contains the back button, product title, and module navigation in that order.
- Each module entry is a compact text tab with a restrained border and background.
- The active entry uses the existing blue accent treatment; inactive entries remain neutral with a light hover state.
- The decorative canvas remains flexible between the left navigation and the right-side account controls.

## Responsive Behavior

- Desktop and tablet layouts keep all available entries on one line.
- On narrow screens, the module navigation moves to a full-width second header row and remains a single horizontally scrollable line.
- Entry labels never wrap inside an individual tab.

## Accessibility

- Keep the navigation's `tablist` and each entry's `tab` role.
- Keep `aria-selected` synchronized with `currentWorkspace`.
- Preserve native keyboard focus and button activation behavior.

## Verification

- Add a focused source-level regression test that asserts the Header renders direct module entries and no longer renders the collapsible trigger.
- Run the focused test, the frontend build, and `git diff --check`.
- Inspect desktop and mobile layouts in the browser to confirm placement, overflow behavior, active state, and absence of overlap.
