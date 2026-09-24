# A small tool for thinking in plain text

The editor is where thinking happens. The browser adds spatial perspective. Saving is the entire bridge between them: no export step, refresh ritual, or second document to keep in sync.

## Principles

1. **The file is the source of truth.** Keep content and relationships readable, portable, and useful in a terminal. The browser is a view, with local layout preferences rather than a competing content store.
2. **Use only the structure that earns its place.** A note has a name and text. An arrow adds a dependency. A class adds attribute rows. A border is optional. Resist building a general markup language or a drawing application.
3. **Preserve the reader's bearings.** Names give notes identity. Existing positions seed updates, while attraction and repulsion let relationships reshape the graph gently. Errors keep the last useful view on screen and explain what to fix.
4. **Let motion explain change.** Keep text at the reader’s chosen scale; move the camera toward a new thought instead of shrinking the graph to fit. A newly inserted thought gently settles among its neighbours. Motion is brief, restrained, and optional through reduced-motion settings. Nothing needs to float forever.
5. **Keep the canvas quiet.** Fixed-width notes, restrained outlines, readable arrows, soft colours, and generous space. Controls sit at the edges. Source detail appears only when requested.
6. **Keep the implementation proportionate.** Small TypeScript modules, native browser features, and a local server. No database or application framework is needed to observe a text file and draw its relationships.

## Decisions made while completing the first working version

- Preserve the original example and the 100px width constant.
- Accept both documented `@target` references and the example's bare `target` form.
- Default to borderless text notes and rectangular class compartments; use `#border` to give a text note a rounded border.
- Follow the original visual inheritance description: parent → child, hollow diamond at child. Document this nonstandard convention rather than silently substituting UML.
- Compile to an in-memory graph and render it as HTML/CSS plus SVG. Avoid generated-file churn.
- Save-triggered live updates use server-sent events, directory watching, and a polling fallback for reliability with editor replacement writes.
- Keep the initial layout deterministic and motion bounded. Offer a zen view that leaves only the graph visible. Manual placement handles the last small adjustments without growing a layout-control interface.
- On live insertion, spawn new notes randomly near the existing graph's barycenter with a guaranteed minimum gap; expand the search radius when crowded, then let them settle. Use existing positions as the starting point, then let all notes settle through local attraction and repulsion.

Future additions should make the edit–save–understand loop clearer or more reliable. If a feature needs an account, a new source of truth, constant animation, or several configuration screens, reconsider whether it belongs here.
