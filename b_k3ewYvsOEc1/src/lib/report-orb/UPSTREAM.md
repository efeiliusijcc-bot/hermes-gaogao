# Orb renderer attribution

This directory contains an adapted subset of the Liquid Orb Editor:

- Repository: https://github.com/LerSent001/orb
- Upstream commit: 6e12177a41a5dc773689133fc4360a355ad1b1b4
- License: MIT, preserved in LICENSE

Hermes keeps only the framework-independent WebGPU renderer, shader, uniform
mapping, and one opal-derived preset. Local changes limit rendering to 30 fps,
cap device pixel ratio at 1.5, pause while the document is hidden, render a
single static frame for reduced-motion users, and use a blue/cyan/green palette.
