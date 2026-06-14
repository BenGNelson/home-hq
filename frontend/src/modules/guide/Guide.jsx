import { useApi } from '../../lib/useApi.js'
import { Spinner } from '../../components/ui.jsx'
import { containerNotes, containerUrl } from '../../lib/hostLocal.js'

function Section({ title, children }) {
  return (
    <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-400">
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  )
}

function Code({ children }) {
  return (
    <code className="rounded bg-slate-950 px-1.5 py-0.5 text-xs text-slate-200">
      {children}
    </code>
  )
}

const ENDPOINTS = [
  ['/api/health', 'Liveness + server name.'],
  ['/api/system', 'CPU %, RAM used/total, uptime (psutil).'],
  ['/api/disk', 'Total / used / free for the storage array.'],
  ['/api/containers · /{name} · /{name}/logs', 'Container list, one container’s live CPU/mem/net, and its recent logs (tail-limited; sensitive ones excludable).'],
  ['/api/network', 'Per-interface byte counters (read from the host’s /proc).'],
  ['/api/vpn', 'VPN egress leak check — exit IP vs home IP, from a host timer.'],
  ['/api/tailscale', 'Tailnet devices (online state, exit node, last seen), from a host timer running `tailscale status`.'],
  ['/api/uptime', 'Per-service availability (status, uptime % 24h/7d, latency), from a host prober that can reach firewall-restricted services.'],
  ['/api/storage/db', 'SQLite file size + per-table row counts — the local DB’s growth, with caps shown.'],
  ['/api/plex/insights', 'Plex activity trends over time (streams/transcodes/bandwidth) + stats.'],
  ['/api/diskio', 'Per-disk read/write byte counters (/proc/diskstats); the Storage page graphs rates client-side.'],
  ['/api/raid', 'Software-RAID array health, parsed from /proc/mdstat.'],
  ['/api/smart', 'Per-drive SMART health, collected daily by a host timer.'],
  ['/api/smart/{drive}/attributes', 'One drive’s full SMART attribute table (on-demand, when a row is expanded).'],
  ['/api/drive-watchdog', 'Health + recent auto-recovery events of a watched external drive (SMART can’t read USB enclosures).'],
  ['/api/storage/trends', 'SMART + capacity history (daily samples) + a days-until-full projection — powers the Storage page.'],
  ['/api/storage/space', 'Top-level “what’s using space” breakdown — a cached daily du scan of the array.'],
  ['/api/printer', 'Live 3D-printer telemetry, cached from a persistent MQTT connection (Bambu LAN mode).'],
  ['/api/printer/camera/stream', 'Live chamber-camera MJPEG feed (opt-in; on-demand TLS stream on :6000).'],
  ['/api/printer/camera', 'Single latest chamber-camera JPEG frame (snapshot/fallback).'],
  ['POST /api/printer/command', 'Pause / resume / stop / light — published over the MQTT connection.'],
  ['/api/printer/history', 'Completed-print log + stats (count, success rate, total print time), from SQLite.'],
  ['/api/backups', 'Lists the age-encrypted config backups (read-only).'],
  ['/api/alerts', 'Push-alert config, each rule’s current state (incl. muted), and recent history (+ POST /test, POST /{rule}/mute).'],
  ['/api/readme · /asset/{n}', 'The project README (markdown) + its screenshots, for the in-app viewer.'],
  ['/api/server-guide', 'The host’s own server guide (markdown), for the Server Guide page.'],
  [
    '/api/plex · …',
    'Status (streams/transcodes), now-playing sessions, recently added, libraries, background sync, cached library items & show episodes, on-demand item detail, and a poster proxy.',
  ],
]

// Plain-language one-liners for the tools named on this page, so the guide
// doubles as a learning reference. Generic — no host specifics.
const GLOSSARY = [
  ['React', 'A UI library: build the interface from small, reusable components that re-render when their data changes.'],
  ['Vite', 'A frontend build tool — a fast dev server with instant hot-reload while you code, plus a bundler that packages the app into small, optimized static files for production.'],
  ['Tailwind CSS', 'Utility-first CSS: style by composing tiny classes (flex, p-4, text-sm) right in the markup instead of writing separate stylesheets.'],
  ['React Router', 'Client-side routing: swaps pages by URL without a full page reload — the module registry maps each route to a module.'],
  ['PWA + service worker', 'A Progressive Web App installs to your home screen and launches fullscreen; a background service-worker script precaches the app shell so it loads instantly — but never caches live /api data.'],
  ['FastAPI', 'A Python web framework for building JSON APIs quickly, with automatic request validation and interactive docs.'],
  ['pydantic-settings', 'Reads and validates configuration from environment variables into a typed object — the one place host values enter the backend.'],
  ['psutil', 'A Python library that reads system metrics — CPU, memory, disk, uptime — straight from the OS.'],
  ['Docker', 'Packages an app with everything it needs into a container that runs the same on any machine.'],
  ['Docker Compose', 'Describes a multi-container app in one YAML file and starts them together.'],
  ['Docker socket', 'The local API that Docker listens on. Full access to it = control of the host, so the backend never mounts it directly.'],
  ['docker-socket-proxy', 'A tiny gateway that holds the Docker socket and exposes only the read-only container endpoints the backend needs — so a backend compromise cannot drive Docker or escape to the host.'],
  ['nginx', 'A fast web server / reverse proxy: in production it serves the built static frontend and forwards /api calls to the backend.'],
  ['SQLite', 'A complete SQL database that lives in a single file — no separate database server to run.'],
  ['age', 'A modern file-encryption tool. It encrypts to a public key, so only the matching private key (kept off the server) can decrypt.'],
  ['WireGuard', 'A fast, modern VPN protocol; the VPN gateway uses it to build an encrypted tunnel.'],
  ['Tailscale', 'A mesh VPN that gives each device a private address, so you can reach the server from anywhere without opening ports to the internet.'],
  ['MJPEG', 'A simple video stream that is just a series of JPEG images. A plain <img> can display it, swapping frames in place over one connection — how the 3D-printer chamber camera is shown.'],
  ['RAID (RAID5)', 'Combines several disks for capacity plus redundancy; a RAID5 array keeps working even if one disk fails.'],
  ['SMART', 'Self-monitoring data that drives expose — temperature, wear, reallocated sectors — used to catch a failing disk early.'],
  ['systemd timer', "Linux's built-in scheduler (a modern cron) that runs a task on a schedule, like the daily SMART collector."],
  ['MQTT', 'A lightweight publish/subscribe messaging protocol for devices. The 3D printer publishes its state to a local broker and the backend subscribes — the one push-based data source (everything else is pulled on request).'],
]

// The live, host-specific part: real containers from the API + your notes.
function ContainerReference() {
  const { data, error, loading } = useApi('/containers', 30000)
  if (loading) return <Spinner label="reading containers…" />
  if (error) return <p className="text-rose-400">unavailable — {error}</p>
  if (data?.available === false) return <p className="text-amber-400">Docker unavailable</p>

  const list = data?.containers ?? []
  return (
    <div className="space-y-2">
      <p className="text-slate-400">
        Live from <Code>/api/containers</Code>, annotated from{' '}
        <Code>host.local.jsx</Code> (gitignored). Add a container and it shows up
        here automatically — just give it a description.
      </p>
      {list.map((c) => {
        const note = containerNotes[c.name]
        const link = containerUrl(c.name)
        return (
          <div key={c.name} className="rounded-lg border border-slate-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-100">{note?.displayName ?? c.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    open ↗
                  </a>
                )}
                {c.status}
              </span>
            </div>
            {!note?.hideImage && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                {note?.displayImage ?? c.image}
              </p>
            )}
            <p className="mt-1 text-sm">
              {note?.purpose ?? (
                <span className="italic text-slate-500">
                  No description yet — add it to host.local.jsx
                </span>
              )}
            </p>
          </div>
        )
      })}
      {Object.keys(containerNotes).length === 0 && (
        <p className="text-xs text-slate-500">
          Tip: create <Code>frontend/src/modules/guide/host.local.jsx</Code>{' '}
          exporting <Code>containerNotes</Code> to annotate these.
        </p>
      )}
    </div>
  )
}

export default function Guide() {
  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-xl font-semibold">Under the Hood</h2>
      <p className="mb-4 text-xs text-slate-400">
        How the Home HQ <em>software</em> fits together — architecture, modules,
        and the tech behind them. (For how this <em>server</em> is set up, see the
        Server Guide; to run it yourself, see the README.)
      </p>

      <Section title="Overview">
        <p>
          Home HQ is a self-hosted personal platform: a small <em>shell</em> (nav
          + layout) that <em>modules</em> plug into, grown over time. The platform
          is the project — it never “finishes.” Each module is a self-contained
          feature (dashboard, Plex, containers, network, backups) that hangs off
          the shell.
        </p>
        <p>
          Everything runs in Docker from one repo, and no host-specific values
          live in the code — they come from the environment — so the repo is safe
          to publish and reproducible on any machine.
        </p>
      </Section>

      <Section title="Frontend">
        <p>
          React + Vite + Tailwind. The single seam the platform grows along is the{' '}
          <strong>module registry</strong> in <Code>App.jsx</Code>: each entry
          declares a nav item + a route. Adding a module = one entry + one route.
        </p>
        <p>
          <Code>shell/Shell.jsx</Code> is the sidebar + layout frame (a slide-in
          drawer on phones). <Code>lib/useApi.js</Code> is a small hook that
          fetches + polls an endpoint and returns <Code>{'{data, error, loading}'}</Code>.
          Shared building blocks live in <Code>components/</Code> (e.g. the
          hand-rolled live <Code>Graph</Code>, and <Code>MediaTable</Code> reused
          for movies and episodes). In dev, Vite hot-reloads and proxies{' '}
          <Code>/api</Code> to the backend.
        </p>
      </Section>

      <Section title="Backend">
        <p>
          A FastAPI app. One concern per file under <Code>routers/</Code>, each an{' '}
          <Code>APIRouter</Code> mounted under <Code>/api</Code>. Every endpoint
          that touches an external system (Docker, Plex, a mount) catches failures
          and returns an “unavailable” state instead of erroring, so the UI always
          renders something.
        </p>
        <p>
          FastAPI builds an interactive <Code>OpenAPI</Code> reference from the
          routes for free — explore every endpoint (grouped by domain) at{' '}
          <Code>/api/docs</Code>, or via the <strong>API</strong> link in the
          sidebar’s Docs section.
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-800">
              {ENDPOINTS.map(([path, desc]) => (
                <tr key={path}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">
                    {path}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Data flow example: the browser polls <Code>/api/system</Code> →{' '}
          <Code>main.py</Code> → <Code>routers/system.py</Code> → <Code>psutil</Code>{' '}
          reads the host kernel → JSON back. Because containers share the host
          kernel, CPU/RAM/uptime are the host’s; disk needs the storage path
          mounted in.
        </p>
      </Section>

      <Section title="Data & state">
        <p>
          Mostly live/ephemeral. Live graphs derive rates from cumulative counters
          in the browser, so the backend stays stateless. The one exception is a{' '}
          <strong>SQLite cache</strong> (on a Docker volume) for the Plex library
          browser.
        </p>
      </Section>

      <Section title="Plex library browser">
        <p>
          A background <strong>sync</strong> walks Plex once into SQLite (movies,
          shows, episodes with runtime, resolution, codec, size). The browser then
          reads from SQLite, so search/sort are instant and don’t hammer Plex. The
          rule: <strong>cache the lists</strong> (browsed/searched/sorted), but{' '}
          <strong>fetch single-item detail + posters on demand</strong> (viewed
          rarely, not searched). Posters are proxied so the Plex token never
          reaches the browser.
        </p>
      </Section>

      <Section title="Network module">
        <p>
          Per-interface throughput, live. The backend reads cumulative byte
          counters from the host’s <Code>/proc</Code> via <Code>/api/network</Code>;
          the browser turns successive samples into in/out <strong>rates</strong>{' '}
          and draws them on the same hand-rolled <Code>Graph</Code> the dashboard
          uses. Interfaces get friendly labels, stacked full-width with a time
          axis. Nothing is stored — rates are derived client-side, so the backend
          stays stateless.
        </p>
      </Section>

      <Section title="Printer module">
        <p>
          The one <strong>push-based</strong> source. In LAN mode a Bambu printer
          publishes telemetry to a local MQTT broker, so instead of polling on
          request the backend keeps a <strong>persistent MQTT connection</strong>{' '}
          alive (started from the app lifespan). It subscribes to the printer’s
          report topic, asks for a full state dump on connect, then deep-merges
          each partial update into a cached snapshot. <Code>/api/printer</Code>{' '}
          hands back that snapshot — state, progress, layer, time remaining,
          nozzle/bed/chamber temps, and AMS filament. It degrades gracefully
          (<em>not configured</em> / <em>connecting</em> / <em>offline</em>), and
          the whole module hides itself when no printer is set. Host values
          (address, serial, access code) live only in <Code>.env</Code>.
        </p>
        <p className="mt-2">
          <strong>Controls</strong> (<Code>POST /api/printer/command</Code>) publish
          pause/resume/stop/light over the same MQTT connection — allowlisted
          server-side, with Stop behind a confirm step in the UI. The optional{' '}
          <strong>chamber camera</strong> is separate: the P1 series has no RTSP, so
          it streams JPEG frames over an authenticated TLS socket on <Code>:6000</Code>.
          That reader connects only while you’re watching (so it doesn’t fight
          Bambu Studio’s live view). The UI shows it as a live MJPEG feed —{' '}
          <Code>/api/printer/camera/stream</Code> re-streams the frames so a plain
          image element swaps them in place over one connection — while{' '}
          <Code>/api/printer/camera</Code> still serves a single frame as a snapshot.
          It’s opt-in (<Code>PRINTER_CAMERA</Code>) since it may need its own network
          reachability.
        </p>
      </Section>

      <Section title="Storage health (RAID + drives)">
        <p>
          Two layers. <strong>Array health</strong> comes from <Code>/api/raid</Code>,
          which parses the kernel’s software-RAID status — a healthy array reads
          as all members up, a degraded one flags red. <strong>Per-drive SMART</strong>{' '}
          comes from <Code>/api/smart</Code>: a privileged host timer collects each
          disk’s SMART attributes once a day into a small JSON file the backend
          reads read-only, so the app itself never needs disk privileges. The
          Drives widget flags reallocated/pending sectors, high wear, and
          overheating. A disk behind a USB bridge that can’t pass SMART through
          simply shows “n/a”.
        </p>
        <p className="mt-2">
          The <strong>Storage page</strong> adds the <em>time</em> dimension. A
          lightweight background thread records one SMART + capacity sample per
          day into SQLite, and <Code>/api/storage/trends</Code> serves it back as
          per-drive temperature/wear charts plus a capacity <strong>growth
          projection</strong> — a least-squares fit of usage over time that
          estimates “full in ~N weeks”. The trend is the real early-failure
          signal; a single snapshot only tells you about right now.
        </p>
      </Section>

      <Section title="Backups">
        <p>
          A host script + weekly systemd timer tars the server’s config, streams it
          through gzip into <Code>age</Code>, and writes an encrypted bundle to the
          RAID. It encrypts to a <strong>public key only</strong> — the private key
          never touches the server — so a compromised host still can’t read its own
          backups. Restore happens off-box via SSH/rsync + the private key. The app
          only <em>lists</em> them.
        </p>
      </Section>

      <Section title="Config & secrets">
        <p>
          12-factor: all host-specific values are read from the environment in{' '}
          <Code>config.py</Code> and nowhere else. <Code>.env</Code> (gitignored)
          holds the real values; <Code>.env.example</Code> documents them with
          placeholders. Nothing secret or host-identifying is committed.
        </p>
      </Section>

      <Section title="Glossary — what each piece is">
        <p>
          Plain-language one-liners for the tools named above, so this page
          doubles as a learning reference.
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-800">
              {GLOSSARY.map(([term, def]) => (
                <tr key={term}>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-medium text-slate-200">
                    {term}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Containers on this server">
        <ContainerReference />
      </Section>

      <Section title="Keeping this current">
        <p>This page is meant to be a living doc. When things change:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>New module?</strong> Add it to the registry in{' '}
            <Code>App.jsx</Code> and add a section here.
          </li>
          <li>
            <strong>New endpoint?</strong> Add a row to the table above and to{' '}
            <Code>docs/ARCHITECTURE.md</Code>.
          </li>
          <li>
            <strong>New container?</strong> It appears automatically — just add its
            description to <Code>host.local.jsx</Code>.
          </li>
        </ul>
        <p className="text-xs text-slate-500">
          Deeper design rationale + the decision log live in{' '}
          <Code>docs/ARCHITECTURE.md</Code>.
        </p>
      </Section>
    </div>
  )
}
