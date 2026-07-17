# Design QA: Draft Assistant Floating Actions

## Reference

- Production screenshot supplied through browser comments at `1238 x 994`.
- Requested placement: back action left of the AI controls, confirm action right of the AI controls, with the complete group remaining fixed while scrolling.

## Desktop Verification

- Viewport: `1238 x 994`.
- Dock position: `fixed`, `1040px` wide, `68px` high.
- Horizontal order: back (`x=109`), AI controls (`x=245`), confirm (`x=975`).
- Dock stayed at `y=910` after scrolling from the top to the bottom of a long outline.
- At maximum scroll, the final outline section ended `136.5px` above the dock.
- No horizontal overflow.

## Mobile Verification

- Viewport: `390 x 844`.
- First row: AI title and input.
- Second row: back, apply AI modification, and confirm.
- Expanded feedback input height: `92px`; controls remained separated with no overlap.
- At maximum scroll, the final outline section ended `148.4px` above the expanded dock.
- No horizontal overflow.

## Interaction And Runtime

- Feedback input focus/value expands the dock.
- Back, revise, and confirm controls retain their existing accessible names.
- Final browser console check returned no errors or warnings.

## Confirmation Page Verification

- Reference: production confirmation-page screenshot supplied through browser comments at `1238 x 994`.
- Desktop dock: `position: fixed`, `920px` wide, `66px` high, with back at `x=172` and confirm at `x=904`.
- Desktop dock stayed at `y=912` after scrolling; the final outline section ended `77.9px` above the dock at maximum scroll.
- Mobile viewport: `390 x 844`; both buttons remained in one row at `172px` wide each.
- Mobile dock stayed fixed while scrolling; the final outline section ended `119.9px` above it at maximum scroll.
- No desktop or mobile horizontal overflow.
- Final confirmation-page browser console check returned no errors or warnings.

final result: passed
