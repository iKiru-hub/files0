# files0

Plain text, quietly connected. Write a file in Neovim, save it, and see its notes and dependencies take shape in the browser beside it.

## Use it

Requires Node.js 22 or newer. From this directory:

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000** and select a file. In another terminal:

```sh
nvim vsfiles/note0.txt
```

Save with `:w`. The graph updates automatically, normally within a fraction of a second. `hello.graph` is a second, small example; the original `note0.txt` is unchanged. New `.txt` and `.graph` files appear in the file picker automatically. No Neovim plugin is required. Keep the terminal and browser side by side using your window manager.

The server keeps running in its terminal until Ctrl+C. To run it in the background instead:

```sh
npm start > /tmp/files0.log 2>&1 &
# The shell prints the background job's PID; use `kill PID` to stop it.
```

Choose another directory or port:

```sh
npm start -- --dir ~/notes/graphs --port 3001
```

The directory must exist. `VSFILES_DIR` and `PORT` are equivalent environment variables. The server binds only to `127.0.0.1`; it reads your source files without modifying them and stores only linked-file paths locally. There is no account, database, or remote service.

## Files from other folders

On the homepage, click **+** beside Your files. On macOS, **Choose file…** opens the native file chooser; alternatively, paste an absolute file path and click **Add to library**. Any regular UTF-8 text file up to 1 MB can be linked, regardless of its extension. Its contents still follow the files0 language.

The file stays at its original location and is watched in place. Edit and save it in Neovim as usual. The homepage shows its full path so identically named files remain distinguishable. Links survive browser and server restarts in `.files0/library.json` in the project directory (ignored by Git). Re-adding the same file does not create a duplicate. A missing file remains listed with a diagnostic; restoring it at its saved path resumes updates. Moving a file to a different path requires adding that new path.

With a graph open and the page focused, **Z** toggles zen mode, including after using the font-size selector; **Escape** exits. The shortcut leaves typing in text fields alone. Browser address-bar and developer-tool focus must return to the page first.

## The language

```text
@idea
A thought worth keeping.
#to @next

@next
Where it might lead.
#border none

@class vehicle
-- wheels
-- move()

@class car
#inherit @vehicle
```

| Expression | Meaning |
| --- | --- |
| `@name` | Begin a borderless note. The name is its stable identity and displayed heading. |
| Plain text | Note body; blank lines and line breaks are retained. |
| `#to @target` | An arrow from the current note to the target. |
| `#with @neighbor` | An undirected connection: a plain line, straight when clear, bending around obstacles when needed. |
| `#to @class_name 2` | Point to the second attribute row of a class. Indices start at 1. |
| `#from @class_name 1` | Start the arrow at the first attribute row of a class. |
| `#from 1 #to @target 2` | Connect row 1 of this class to row 2 of the target class. |
| `#to @target 2 #from 1` | The same connection, with the target written first. |
| `#from @source` | An arrow from the source to the current note. |
| `#use @target` | An arrow to the target with a closed, hollow triangular head. |
| `@class name` | A class with a rectangular outline and attribute compartments. |
| `-- attribute` | A class row, displayed with a `+` prefix. |
| `#inherit @parent` | Connect parent → current child, with a hollow diamond at the child. |
| `#color 222c3a` | Give the current note a 2px border in a six-digit hex color (case-insensitive, no leading `#`). Enables a rounded border for plain notes; keeps existing shapes. A later `#border none` hides it. |
| `#border` | Show a border: rounded for notes, rectangular for classes. |
| `#border none` or `#noborder` | Text without a surrounding border. |
| `#border rounded` / `#border rectangle` | Choose an explicit border. |
| `// comment` | A whole-line comment, omitted from the graph. |

References also accept bare names, such as `#to target`, `#to car 2`, and `#inherit parent`. Classes are declared with `@class name`; attribute indices follow the referenced name, separated by whitespace. Legacy double-colon spellings remain readable for existing files. Directives occupy their own lines. Names are case-sensitive, unique across notes and classes, and can contain Unicode letters/numbers, `_`, `.`, and `-` (starting with a letter, number, or `_`). Spaces belong in the body, not the identifier. References may point forward. Cycles and self-links are valid; identical edges are deduplicated.

Start a line with `\` to display a reserved expression literally: `\@mention`, `\#heading`, `\-- text`, or `\// text`. Text is displayed literally; HTML is never executed, and Markdown is not interpreted.

The initial notes disagree about inheritance direction. This implementation follows their **visual** rule (hollow diamond at the child), rather than imposing UML's different convention. `#inherit @parent` still lives inside the child's declaration.

`#with` connects whole notes without assigning temporal order. It participates in spatial attraction and routing like other connections. Bare names (`#with neighbor`) and forward references work; repeating the connection from either end draws only one line. Attribute indices remain specific to `#to` and `#from`.

## The canvas

- **Dark / Light** switches the theme. The first visit follows your system preference; your choice is then remembered.
- **Text** sets note typography from 10 to 18 px without changing note width; new sessions default to 12 px. Bodies use generous line spacing, with padding that adapts to the note width. Notes reflow and settle to preserve spacing.
- **− / +** and scrolling zoom the whole graph; the percentage button resets to 100%. Font size, theme, and manual zoom persist locally. **Fit** (or **F**) clears the manual zoom preference and frames the graph automatically.

- Text stays at your chosen size: opening a graph, saving, switching Time, or resizing the window never automatically fits or changes zoom. New notes gently bring the camera to the last inserted note, at two-thirds of the viewport width and halfway down. Older notes can move outside the view. Panning, dragging, keyboard placement, or zooming takes over until another note is inserted. Reduced motion makes this shift immediate.
- Edges stay straight, including diagonally, whenever the path is clear; otherwise they try short diagonal detours and rounded bends around notes, preferring fewer bends and avoiding crossings when the detour stays reasonable, including in Time view. Routing favors short physical paths and penalizes sharp reversals. It is computed when the layout changes, with bends following the animated endpoints. Dense or non-planar graphs, and transitions while notes move, may still have crossings.
- Drag the background to pan, or use **H / J / K / L** to move the view left / down / up / right. Hold a key to continue; **Shift** takes larger steps. Scroll to zoom. **F** fits the whole graph; **+ / −** zoom.
- **Zen** (or **Z**) hides all page chrome, status messages and the grid. Press **Z** or **Escape** to return. Live updates, dragging, pan and zoom keep working.
- Drag a note to arrange it. Releasing it lets its neighbours settle around the new position. Focus a note and use arrow keys to move it; Shift makes larger steps.
- Settled positions persist locally in the browser, per directory and file, and seed the next layout. Names are identities: renaming a note creates a new identity. Use **Fit** if a new note lands outside your current view.
- New notes spawn with at least 48 canvas pixels of clearance from every other note’s bounds, including notes added in the same save. Placement searches randomly within 180 canvas pixels of the existing graph’s barycenter (the average of note centers), then expands outward if that area is crowded. The animation stops once settled, and the system's reduced-motion preference is respected.
- **Source** shows the file and a copyable Neovim command. The **?** button contains a short language reference.
- Invalid saves show source-line diagnostics and retain the last valid graph in the current session. Fix the file and save again. After a fresh page load, an invalid file has no previous graph to show.
- Deleted files retain their last visible graph with an explanation; recreating the file resumes updates. The live connection automatically reconnects after a server restart.

`notes/constants.yaml` retains the original width setting:

```yaml
note_width: 100px
```

Change it while the server runs; all note widths update within about a second. Widths are clamped to 80–480 pixels. Missing or unrecognised settings use 100 pixels. Height follows the text. Canvas zoom does not change this underlying fixed-width model.

## Temporal view

Click **Time** or press **T** while a graph is open. Press it again to return to the spatial layout. The shortcut also works in zen view. Live saves and font-size changes update the temporal layout.

Time flows **left to right**. Only `#to` and `#from` assign temporal order; `#from @source` means source → current note. Each edge advances one step unless a merge needs to wait for a longer incoming path. A chain stays on one horizontal lane. A fork's targets share the next column, with each branch continuing on its own lane. In file order, siblings grow from the middle alternately above and below; their parent remains centered behind the group. Independent notes and chains sit nearby, with only 16px more vertical separation than neighbouring lanes within a chain. Merges occupy the latest required time column. `#use` and `#inherit` stay visible with their normal arrowheads but add no temporal constraints.

Disconnected sequences use declaration order as a timing cue: a head aligns with the time column of the latest note declared before it in an already placed sequence. For example:

```text
@a
#to b
@b
#to c
@x
#to y
@c
@y
```

Here `a → b → c` occupies steps 0, 1, 2. Because the new head `x` is declared after `b` and before `c`, `x → y` occupies steps 1, 2 on a separate lane. Independent notes with no temporal edges share the current time column rather than inventing a new step.

Cycles cannot imply a strictly forward order, so their notes share one column on separate lanes; outgoing edges then advance time. Dragging in temporal mode returns notes to their chronological lanes on release. Switch back to spatial mode for free arrangement. Spatial and temporal positions are stored separately.

## Design

The project is intentionally small: Express, a pure TypeScript compiler, HTML/CSS notes, SVG edges, and a few small browser modules. There is no UI framework, graph library, physics dependency, or external font request. The browser bundle is built locally with esbuild.

The pipeline is **file → compiler → graph → HTML/SVG**. Generated markup stays in memory instead of rewriting an HTML/CSS pair on disk after every save. Server-sent events carry change notifications; the client fetches the selected document and updates the existing canvas. Directory watching supports atomic editor saves, with a one-second polling fallback. Content hashes suppress redundant renders. A short debounce avoids most intermediate saves; invalid intermediate syntax never replaces a valid graph.

Initial layout groups connected notes, condenses cycles, and ranks dependencies left to right. Updates start from existing positions, sample clear new note positions within a disk around the existing graph's barycenter, expanding the search when necessary, and resolve rectangular overlaps. Notes added together share the same pre-insertion barycenter. Saved positions are restored when reopening a file. The radius and minimum gap are the `SPAWN_RADIUS` and `MIN_NODE_GAP` constants in `webserver/client/layout.ts`. A bounded force simulation uses short springs for direct neighbours and weaker springs for second-degree neighbours. Repulsion is local, with gentle gravity and a small pull toward existing positions. Collisions separate along the shortest axis instead of throwing notes onto outer rings. Rectangular clearance remains enforced. Same-size text edits preserve the layout. Notes animate to the new equilibrium after saves and released drags; animation frames stop once settled. Box caption measurements and edge interpolation distances are cached between layout changes, avoiding repeated layout measurements during animation. Reduced-motion users receive the settled layout immediately. Routing tries straight lines first, then compact bends around notes. It may keep a crossing rather than send an edge on a disproportionate tour around the graph; dense graphs and moving transitions can still have crossings. Temporal columns have an 80px gap, and siblings occupy contiguous vertical blocks sized to their actual note heights. Competing branches move as whole blocks instead of interleaving their children. Drag notes to refine spatial arrangements.

Files are limited to 1 MB and graphs to 500 notes. The default directory automatically lists regular `.txt` and `.graph` files; subdirectories, hidden files, editor backups, and symbolic links are ignored during discovery. Explicitly linked files may live elsewhere and use any extension; symlinks selected explicitly resolve to their real target path. Source previews display up to 5,000 lines. There is no recursive folder browser or in-browser editing.

See [the design principles](notes/philosophy.md) and the original sketches in `notes/`.

## Development and verification

```sh
npm run dev          # rebuild/restart when application source changes
npm run check        # TypeScript checks
npm run build        # production output in dist/
npm test             # compiler, layout, filesystem and HTTP/SSE integration tests
npx playwright install chromium
npm run test:browser # real-browser workflow tests, isolated temporary files
```

The browser tests cover atomic saves, invalid-save recovery, file creation/deletion, source inspection, borders and classes, dragging, keyboard positioning, persisted positions, pan/zoom, literal HTML, cycles, narrow windows, and reduced motion. The test server uses port 3177 and does not modify `vsfiles/`.

Source map:

| File | Responsibility |
| --- | --- |
| `webserver/compiler.ts` | Language and source-line diagnostics |
| `webserver/store.ts` | File snapshots, config, watching and revisions |
| `webserver/server.ts` | Local HTTP API, event stream and static assets |
| `webserver/client/app.ts` | File navigation, connection state and source UI |
| `webserver/client/layout.ts` | Initial positions and edge geometry |
| `webserver/client/physics.ts` | Attraction, repulsion and equilibrium |
| `webserver/client/temporal.ts` | Time columns, parallel branches and file-order alignment |
| `webserver/client/graph.ts` | DOM renderer, interactions and settling motion |
| `webserver/public/` | Page structure and visual design |


### Inline math

Use `\( ... \)` inside note bodies or class attributes:

```text
@energy
Energy is \(E = mc^2\).
A fraction: \(\frac{a}{b}\), a root: \(\sqrt{x}\), and Greek letters: \(\alpha_i\).
```

Math is rendered with locally bundled KaTeX and fonts, with no CDN connection. Unsupported or malformed expressions remain visible as source with a dotted underline; unmatched delimiters stay plain text. Source files are unchanged. Ordinary HTML remains literal text.

The homepage **Note width** field accepts 80–480 pixels and saves your preference in this browser for all files. **Reset** returns to the width configured in `constants.yaml`. This changes note layout without changing zoom. Underscores in displayed note and class titles become spaces; IDs and arrow references remain unchanged.


Use `*text*` for italics and `**text**` for bold in note bodies and class attributes. Formatting can contain inline math. Escape an asterisk as `\*` to display it literally; unmatched markers remain visible. These display changes never alter the source file.

Use the **×** beside a homepage file to remove it from the library. This persists across restarts and keeps the source file on disk. Use **+** to add it again, including files in the watched folder.

Keyboard navigation: **Ctrl+H** returns home; **J/K** select files and **Enter** opens the focused entry. **Ctrl+P / Ctrl+N** step backward/forward through opened files, skipping removed entries. From home, Ctrl+P returns to the last viewed file. History stops at either end; opening another file after stepping back replaces the forward branch. History survives refreshes in the same tab. Shortcuts leave text inputs and dialogs alone.


Attribute connections use the row's position in the source file:

```text
@class car
-- wheels
-- doors

@design
#to @car 2

@inspection
#from @car 1
```

Here `design` points to **doors**, while **wheels** points to `inspection`. Hover a class row to see its index. Indices are 1-based and must exist in the referenced class; `#use` and `#inherit` do not accept them. Inserting or reordering attribute rows changes which attribute an index refers to. Arrows track the row’s rendered center through wrapping, font changes, dragging and layout transitions. Temporal ordering continues to apply between whole notes.


Both ends can address an attribute:

```text
@class engine
-- power
-- speed
#from 1 #to @dashboard 2
#to @dashboard 1 #from 2

@class dashboard
-- speed display
-- power display
```

The first arrow connects **engine.power → dashboard.power display**. The second connects **engine.speed → dashboard.speed display**. Both orders declare an outgoing connection from the current class. The earlier incoming spelling (`#from @source 1 #to 2`) remains accepted for existing files. Both endpoints must be classes, and both indices must exist; forward references work. Declaring the same pair of rows from either end creates a single arrow. These connections also advance time between notes in temporal view.

Parallel edges prefer separate corridors with an 18px gap where space permits. Short shared stems can meet at an exact row anchor. Box padding reserves more room for routes, and edges avoid following a container border too closely; crossing a boundary is still allowed when a connection enters or leaves a box.

### PNG image notes

```text
@image images/sketch.png
A caption with *italic*, **bold**, or \(x^2\).
#to next_step

@next_step
Keep thinking.
```

Paths are relative to the text file, including linked files outside the watched folder. Paths with spaces may be quoted. PNG is supported; absolute paths and URLs are not. Each image starts with its shorter side at **480 canvas pixels** (the maximum note-width setting), keeping its aspect ratio. Drag the small bottom-right handle to resize; focus it and use arrow keys for smaller adjustments, or Shift for larger ones. Double-click the handle to reset. Sizes persist locally per image and file. Captions work like normal note text. Image changes are picked up automatically; missing or invalid PNGs show an inline message. Supported files are up to 20 MB and 40 million pixels.


### Boxes

```text
@boxopen Research
A short subtitle above the outline.
@idea
A first thought.
@boxopen Experiment
@trial
Try it.
@boxclose Research
Text below the Research box.
@result
What happened?
@boxclose Experiment
```

Every note (including classes and images) declared while a box is open belongs to it. Close boxes by name: nested opening/closing makes nested sets; closing Research before Experiment above makes overlapping sets, sharing `trial`. Titles use the box name; subtitles and text after closing support inline formatting and math. Boxes follow their members during movement, resizing and layout changes. They are visual enclosures, not arrow endpoints. Each name is unique; missing closes, unmatched closes and empty boxes produce diagnostics. Box membership attracts notes more strongly than arrows do. Separate boxes and unrelated notes keep clear of one another; nested boxes retain padding, and explicitly intersecting sets can still overlap. Temporal layouts close empty vertical gaps while preserving time columns, sibling order, and aligned chains.


Comments start with `//` on their own line (leading whitespace is allowed). They remain in the raw source and Source panel, but do not appear in notes, captions, attributes, box labels, or the graph. Commented-out directives are ignored. Write `\//` at the start of a line to display a literal `//` line. URLs and `//` within ordinary text are unchanged; trailing inline comments are not part of this syntax.

### Display spacing

Use **Spacing** beside Text and Zoom in the graph footer to bring note boxes closer together or spread them out. The slider sets a preferred edge-to-edge gap from 16 to 200 pixels; **↺** restores the original 48 px. Note dimensions, relationships, and enclosing boxes also influence the final distances. The preference is saved in this browser for all files and applies to spatial and Time views, new notes, and subsequent saves. It changes the arrangement, not text size or zoom; use **Fit** if the expanded graph extends beyond the viewport. Zen mode hides the footer; press **Z** to show the controls again.
