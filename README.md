# OBS Scene Builder

Arrange all your stream overlays on a 1920×1080 canvas in the browser, then paste **one URL** into an OBS Browser Source.

- **Editor:** drag, resize, rotate, layer, lock, hide, snap to guides, auto-save.
- **Public scene:** `/scene/<id>` renders only the finished scene on a transparent background. No login needed, so OBS can load it.
- **Live updates:** move something in the editor and the scene already open in OBS updates without a refresh. Only changed elements are touched, so unchanged iframes never reload.
- **Stack:** Node.js, Express, SQLite (`better-sqlite3`), plain HTML/CSS/JS. No frontend frameworks.

## Deploy to Render

### Before you start: persistent disk

SQLite stores everything in one file. A Render web service's filesystem is **wiped on every deploy and restart**, so without a persistent disk your scenes disappear. Render persistent disks require a **paid instance type** (Starter or higher); the Free instance type cannot attach a disk. The disk is mounted at a path you choose, and this app stores its database in the folder named by the `DATA_DIR` environment variable. Point `DATA_DIR` at the disk's mount path.

A service with a disk runs as a single instance and Render restarts it briefly on each deploy. That is fine for this app, which is meant to run as one instance.

### Option A: Blueprint (recommended)

1. Push this project to a GitHub (or GitLab/Bitbucket) repository.
2. In the Render Dashboard click **New → Blueprint** and select the repo. Render reads `render.yaml`.
3. Render creates the `obs-scene-builder` web service with:
   - build command `npm install`, start command `npm start`
   - a 1 GB disk mounted at `/var/data`, with `DATA_DIR=/var/data`
   - `NODE_VERSION=22`
   - an auto-generated `ADMIN_PASSWORD`
   - health check at `/healthz`
4. When the deploy finishes, open the service's **Environment** tab and reveal `ADMIN_PASSWORD`. Your dashboard login is user `admin` and that password.

### Option B: Manual setup

1. **New → Web Service**, connect the repo.
2. Runtime **Node**. Build command `npm install`. Start command `npm start`.
3. Choose a paid instance type (Starter or higher).
4. Under **Advanced → Add Disk**: name `scene-data`, mount path `/var/data`, size 1 GB.
5. Under **Environment** add:
   - `DATA_DIR` = `/var/data`
   - `ADMIN_PASSWORD` = a long random password
   - `NODE_VERSION` = `22` (anything 20 or newer works)
6. Set the health check path to `/healthz` and create the service.

### Port

The server listens on `process.env.PORT` on `0.0.0.0`. Render sets `PORT` for you (default `10000`), so do not set or hardcode it. If the app fails to bind a port, the deploy fails and the logs say so.

## Using it

1. Open your Render URL and log in (`admin` + your `ADMIN_PASSWORD`).
2. **Create scene**, then **+ Add overlay** and paste a widget URL, an image URL, some text, or your own HTML.
3. Drag overlays into place. Watch for **Saved ✓** in the top bar.
4. In OBS add a **Browser** source:
   1. Paste `https://YOUR-APP.onrender.com/scene/SCENE_ID`
   2. Width **1920**, height **1080**
   3. Leave custom CSS empty. The scene background is already transparent. (Older OBS versions pre-filled a `body { background-color: rgba(0,0,0,0); ... }` rule; keeping it is harmless.)
5. Edit in the browser. OBS updates by itself.

The scene ID is a random 10-character string. Anyone with the URL can view that scene, but only someone with the admin password can edit it.

### Editor shortcuts

| Action | How |
| --- | --- |
| Move | Drag the element, or arrow keys (1 px, hold Shift for 10 px) |
| Turn snapping off while dragging | Hold Alt |
| Resize | Drag a handle. Shift on a corner keeps proportions |
| Rotate | Drag the round handle above the box. Shift snaps to 15° |
| Duplicate / delete | Ctrl+D / Delete |
| Select a locked element | Click it in the list (locked elements ignore canvas clicks so you can click through them) |

### URL parameters

| URL | Result |
| --- | --- |
| `/scene/ID` | The normal scene for OBS: exact pixels, transparent background |
| `/scene/ID?preview=true` | Scales the scene to fit your browser window on a dark checkerboard, for checking in a normal tab. This is what **Preview Scene** opens |
| `/scene/ID?transparent=true` | Forces a transparent background even if you set a solid color in the scene settings |

## Security notes

- **Login:** `ADMIN_PASSWORD` protects the dashboard, editor and every write API using HTTP Basic auth over Render's HTTPS. If the variable is not set the app runs open (fine on your own computer, not on the internet) and logs a warning. Public scene routes never need a login.
- **Overlay iframes are sandboxed.** URL overlays use `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` with no `allow-top-navigation`, so a widget cannot navigate or take over the scene page. `allow-scripts` plus `allow-same-origin` is only safe for cross-origin content, so a URL pointing back at this app gets `allow-scripts` only.
- **HTML widgets are isolated.** Your custom HTML is served from `/widget/...` with a `Content-Security-Policy: sandbox` header and loaded in a sandboxed iframe, so it runs with an opaque origin and cannot read the scene page, the editor or this app's data.
- **Only `http(s)` URLs** are accepted for iframes and images (checked in the browser and again on the server). Text is always rendered as text, never as HTML.
- **Page CSP:** the dashboard, editor and scene only run this app's own scripts. The dashboard and editor also refuse to be framed by other sites.
- **CSRF:** write requests need a custom `X-Requested-With` header, which other sites cannot send without a CORS preflight.
- **No secrets reach the browser.** The password is only read on the server.
- **Sites that refuse embedding:** many sites send `X-Frame-Options` or `frame-ancestors` headers and will show blank inside an iframe. Overlay tools meant for OBS (StreamElements, Streamlabs, your own Render widgets) allow it. Mixed content also applies: an `http://` overlay inside an `https://` scene may be blocked, so use `https://` URLs.
- Pages are served uncached (`no-cache`) and the API with `no-store`, so edits are never stale.

## Performance

- The public scene loads under 10 KB of JavaScript and CSS (uncompressed) and no libraries.
- Hidden elements are not rendered at all in the public scene, so hidden iframes use no CPU or memory.
- Live updates use Server-Sent Events: one idle connection per open scene, a tiny ping every 20 seconds, and a refetch only when you save. If a browser lacks `EventSource`, the scene falls back to a 5 second version check that only applies a change when the version number moved.
- Editor saves are debounced (600 ms after your last change, and at most 2.5 s apart during a long drag), so dragging never sends a request per mouse move.

## Project layout

```
server.js              Express app: pages, admin API, public API, SSE, widget route
lib/db.js              SQLite schema and queries (tables: scenes, elements)
lib/types.js           Server-side validation per overlay type
public/js/render.js    Shared overlay renderer and type registry (editor + scene)
public/js/editor.js    Editor
public/js/scene.js     Public scene runtime
public/js/dashboard.js Scene list
public/js/api.js       Fetch/clipboard/toast helpers
public/css/            overlay.css (shared), scene.css, app.css
views/                 dashboard.html, editor.html, scene.html
render.yaml            Render Blueprint
```

### Adding a new overlay type later

1. Add an entry to `TYPES` in `public/js/render.js`: `label`, `icon`, `defaults`, `fields` (these generate the property panel) and `build(el)` returning a DOM node.
2. Add a matching entry in `lib/types.js` that validates `source` and `props`.
3. Add a tab to the Add overlay dialog in `views/editor.html` and `public/js/editor.js`.

Each element already has a free-form `props` JSON column, which is where type-specific settings (fonts, video options, and so on) go without database changes.

## Run locally

```bash
npm install
npm start          # http://localhost:3000, data in ./data
```

Without `ADMIN_PASSWORD` the dashboard is open locally. To test login: `ADMIN_PASSWORD=secret npm start`.

## Backups

Download `scenes.db` from the persistent disk (Render Shell or SSH), or take a disk snapshot from the service's **Disks** page. Render also takes daily snapshots of persistent disks on paid plans.

## Data model

```
scenes:   id, name, width, height, background, version, created_at, updated_at
elements: scene_id, id, type, name, source, props (JSON), x, y, width, height,
          rotation, opacity, z_index, visible, locked
```

`version` increases on every save, which is what the public scene compares to decide whether to update.

## Disk file (`scenes.json`)

Besides SQLite, every change is written to `DATA_DIR/scenes.json` (atomic write, ~0.5 s after the change). When the app starts with an empty database it rebuilds itself from, in order:

1. `DATA_DIR/scenes.json`
2. `seed/scenes.json` in the project (override with `SEED_FILE`)

**Free-tier trick:** click **Download scenes.json** on the dashboard, save it as `seed/scenes.json`, and commit it. Every deploy and every spin-down restart then reloads your scenes from that file. Changes made after the last commit are only kept until the next restart, so download and commit again after editing. **Import file** merges a downloaded file back in (existing scene IDs are never overwritten).
