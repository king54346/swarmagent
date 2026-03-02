import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listWorkspaces, createWorkspace, deleteWorkspace } from '../api/workspaces'
import type { Workspace } from '../types'

export default function HomePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const loadWorkspaces = async () => {
    try {
      setLoading(true)
      const data = await listWorkspaces()
      setWorkspaces(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWorkspaces()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return

    try {
      setCreating(true)
      await createWorkspace(newName.trim())
      setNewName('')
      await loadWorkspaces()
    } catch (e) {
      alert('Failed to create workspace: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete workspace "${name}"?`)) return

    try {
      await deleteWorkspace(id)
      await loadWorkspaces()
    } catch (e) {
      alert('Failed to delete: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleClearDb = async () => {
    if (!confirm('Clear ALL data? This cannot be undone.')) return

    try {
      await fetch('/api/admin/clear-db', { method: 'POST' })
      await loadWorkspaces()
    } catch (e) {
      alert('Failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Agent WeChat</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Python + React MVP
      </p>

      {error && (
        <div className="toast">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Database not ready</div>
          <div className="mono" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
          <div style={{ marginTop: 10 }} className="mono">
            Try:
            <br />
            1) Start the Python backend: `cd backend-python && uvicorn agent_wechat.main:app`
            <br />
            2) POST /api/admin/init-db
            <br />
            3) Refresh
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link className="btn btn-primary" to="/im">
          Open IM
        </Link>
        <Link className="btn" to="/graph">
          Open Graph
        </Link>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Create Workspace</div>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, maxWidth: 400 }}>
          <input
            className="input"
            type="text"
            placeholder="Workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={creating || !newName.trim()}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Admin</div>
        <button className="btn btn-danger" onClick={handleClearDb}>
          Clear Database
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Workspaces</div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Click to open IM with the selected workspace.
        </p>

        {loading ? (
          <div className="muted">Loading...</div>
        ) : workspaces.length === 0 ? (
          <div className="muted">No workspaces yet. Create one above or open IM.</div>
        ) : (
          <div className="card" style={{ maxWidth: 880 }}>
            <div className="card-title">Recent</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {workspaces.map((w) => (
                <div
                  key={w.id}
                  className="row"
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <Link
                    to={`/im?workspaceId=${encodeURIComponent(w.id)}`}
                    style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ fontWeight: 600 }}>{w.name}</div>
                      <div className="muted mono" style={{ fontSize: 12 }}>
                        {new Date(w.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
                      {w.id}
                    </div>
                  </Link>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    onClick={() => handleDelete(w.id, w.name)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
