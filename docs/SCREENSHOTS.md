# Landing screenshots

`public/screens/{en,ru,az}/{debrief,readiness,route,progress}.png`, mapped in `lib/screens.ts`.
Each set is captured from the demo account (`npm run seed:demo`) with the site in that language,
so the images match the page around them. Retake them after any visual change to those cards.

| file | page | element |
|---|---|---|
| `readiness.png` | `/{l}/profile` | `[aria-labelledby=readiness-title]` |
| `progress.png` | `/{l}/profile` | `[aria-labelledby=progress]` |
| `route.png` | `/{l}/drives/<free-drive id>` | `[aria-labelledby=map-title]` |
| `debrief.png` | `/{l}/drives/<free-drive id>` | `article` (regenerate the debrief in `{l}` first) |

Method: log in as the demo user, set `document.documentElement.style.zoom = 0.5–0.54` so the whole
element fits the viewport, hide the road-scene `<canvas>` elements, scroll the element to the top,
and capture exactly its rectangle. Crop the debrief to the card's bottom edge.
