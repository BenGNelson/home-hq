import DocView from '../../components/DocView.jsx'

// The project's real README, fetched live from /api/readme (no copy, no drift).
export default function Readme() {
  return (
    <DocView
      endpoint="readme"
      title="README"
      subtitle="the project’s public documentation"
      unavailable="README not found on the server."
    />
  )
}
