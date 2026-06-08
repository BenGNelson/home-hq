import { useState } from 'react'
import { useParams } from 'react-router-dom'
import MediaDetail from '../../components/MediaDetail.jsx'
import LibraryNav from '../../components/LibraryNav.jsx'
import BackToLibrary from '../../components/BackToLibrary.jsx'

export default function MovieDetail() {
  const { key } = useParams()
  const [libraryKey, setLibraryKey] = useState(null)
  return (
    <div>
      <LibraryNav activeKey={libraryKey} />
      <BackToLibrary libraryKey={libraryKey} />
      <MediaDetail ratingKey={key} onLoaded={(d) => setLibraryKey(d.library_key)} />
    </div>
  )
}
