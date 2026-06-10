import DocView from '../../components/DocView.jsx'

// The host's own server guide (hardware/host operations), fetched live from
// /api/server-guide. Shows the committed example until SERVER_GUIDE_FILE points
// at a real, host-specific doc.
export default function ServerGuide() {
  return (
    <DocView
      endpoint="server-guide"
      title="Server Guide"
      subtitle="this server’s setup & operations reference"
      unavailable="No server guide configured — set SERVER_GUIDE_FILE in .env to point at your markdown doc."
    />
  )
}
