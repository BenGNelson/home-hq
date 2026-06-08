import { useApi } from '../../lib/useApi.js'
import { Spinner } from '../../components/ui.jsx'
import { formatSize, formatDateTime, formatAgo } from '../../lib/format.js'

export default function Backups() {
  const { data, error, loading } = useApi('/backups', 30000)

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Backups</h2>
      <p className="mb-4 text-xs text-slate-400">
        Encrypted config snapshots — what's needed to rebuild this server.
      </p>

      {/* How it works / how to restore — these are encrypted, listed only. */}
      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300">
        <p>
          A weekly job bundles the server's config and{' '}
          <span className="text-slate-100">age-encrypts</span> it to a public key.
          This machine can create backups but{' '}
          <span className="text-slate-100">cannot decrypt them</span> — only your
          private key (kept off this server) can. To restore, copy a file off via
          SSH/rsync and decrypt it on your own machine:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
{`rsync -av your-server:/path/to/backups/ ./
age -d -i your-private-key.txt FILE.tar.gz.age | tar -xzf -`}
        </pre>
      </section>

      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : loading ? (
        <Spinner label="loading backups…" />
      ) : !data.configured ? (
        <p className="text-sm text-amber-400">
          Not configured — set <code>AGE_RECIPIENT</code> in <code>.env</code> and
          install the backup timer.
        </p>
      ) : !data.dir_present ? (
        <p className="text-sm text-slate-500">
          No backup directory yet — the first scheduled run will create it (or run
          it manually with <code>sudo systemctl start home-hq-backup.service</code>
          ).
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-400">
            <span>
              Last backup:{' '}
              <span className="text-slate-100">
                {data.last_backup ? formatAgo(data.last_backup) : 'none yet'}
              </span>
            </span>
            <span>
              Stored: <span className="text-slate-100">{data.count}</span>
            </span>
            <span>
              Keeping newest <span className="text-slate-100">{data.retention}</span>
            </span>
          </div>

          {data.backups.length === 0 ? (
            <p className="text-sm text-slate-500">
              No backups yet — the weekly timer will create the first one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Backup</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.backups.map((b) => (
                    <tr key={b.name} className="hover:bg-slate-900/40">
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">
                        {b.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                        {formatSize(b.size_bytes)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        {formatDateTime(b.modified)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
