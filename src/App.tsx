import { useEffect } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './lib/db'
import { DEMO_CUES, DEMO_TITLE, DEMO_VIDEO_ID } from './data/demo'
import Home from './pages/Home'
import Watch from './pages/Watch'
import Saved from './pages/Saved'
import Review from './pages/Review'
import Settings from './pages/Settings'
import Topics from './pages/Topics'

const nav = [
  { to: '/', label: '首頁', icon: '🏠', end: true },
  { to: '/saved', label: '生字庫', icon: '📚' },
  { to: '/review', label: '複習', icon: '🧠', badge: true },
  { to: '/topics', label: '主題', icon: '🗂️' },
  { to: '/settings', label: '設定', icon: '⚙️' },
]

export default function App() {
  useEffect(() => {
    // seed the bundled demo video (works fully offline)
    db.videos.get(DEMO_VIDEO_ID).then((v) => {
      if (!v) db.videos.put({ id: DEMO_VIDEO_ID, youtubeId: DEMO_VIDEO_ID, title: DEMO_TITLE, cues: DEMO_CUES, createdAt: Date.now(), demo: true })
    })
  }, [])

  const due = useLiveQuery(async () => {
    const now = Date.now()
    const [w, s] = await Promise.all([db.words.where('dueAt').belowOrEqual(now).count(), db.sentences.where('dueAt').belowOrEqual(now).count()])
    return w + s
  }, [], 0)

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* desktop sidebar */}
      <aside className="hidden md:flex md:w-56 shrink-0 flex-col gap-1 p-4 border-r border-line bg-panel/60">
        <div className="flex items-center gap-2 px-2 py-3 mb-2">
          <img src="/favicon.svg" className="w-8 h-8" alt="" />
          <span className="font-bold text-lg tracking-tight">LingoTube</span>
        </div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ${isActive ? 'bg-sky-500/15 text-sky-300 font-semibold' : 'text-slate-300 hover:bg-panel2'}`}>
            <span>{n.icon}</span><span>{n.label}</span>
            {n.badge && due > 0 && <span className="ml-auto text-xs bg-rose-500 text-white rounded-full px-1.5">{due}</span>}
          </NavLink>
        ))}
      </aside>

      <main className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/review" element={<Review />} />
          <Route path="/topics" element={<Topics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>

      {/* mobile bottom nav */}
      <nav className="md:hidden shrink-0 grid grid-cols-5 border-t border-line bg-panel safe-b">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-sky-300 font-semibold' : 'text-slate-400'}`}>
            <span className="text-lg leading-none">{n.icon}</span>
            <span>{n.label}</span>
            {n.badge && due > 0 && <span className="absolute top-1 right-[22%] text-[10px] bg-rose-500 text-white rounded-full px-1.5">{due}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
