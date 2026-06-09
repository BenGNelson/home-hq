import { useApi } from '../../lib/useApi.js'
import { Spinner } from '../../components/ui.jsx'

// Optional, gitignored host-specific notes (e.g. what each container is for).
// Loaded via import.meta.glob so the build works whether or not the file exists
// — committed code stays generic; your instance merges in private detail.
const hostMods = import.meta.glob('./host.local.jsx', { eager: true })
const host = Object.values(hostMods)[0] ?? {}
const containerNotes = host.containerNotes ?? {}

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
  ['/api/summary', 'Per-subsystem health rollup (ok/warn/down) for the status bar.'],
  ['/api/system', 'CPU %, RAM used/total, uptime (psutil).'],
  ['/api/disk', 'Total / used / free for the storage array.'],
  ['/api/containers · /{name}', 'Container list, and one container’s live CPU/mem/net.'],
  ['/api/network', 'Per-interface byte counters (read from the host’s /proc).'],
  ['/api/raid', 'Software-RAID array health, parsed from /proc/mdstat.'],
  ['/api/smart', 'Per-drive SMART health, collected daily by a host timer.'],
  ['/api/backups', 'Lists the age-encrypted config backups (read-only).'],
  [
    '/api/plex · …',
    'Status (streams/transcodes), now-playing sessions, recently added, libraries, background sync, cached library items & show episodes, on-demand item detail, and a poster proxy.',
  ],
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
        return (
          <div key={c.name} className="rounded-lg border border-slate-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-100">{c.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{c.status}</span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{c.image}</p>
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
      <h2 className="mb-1 text-xl font-semibold">How it works</h2>
      <p className="mb-4 text-xs text-slate-400">
        A living guide to how Home HQ fits together — kept in the app so it’s never
        out of reach.
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
