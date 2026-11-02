import { useEffect, useState } from 'react'
import type { DeletionImpact, FocusMindRepository } from '../../ports/FocusMindRepository'
import type { EntityKind } from '../../state/useAppStore'

interface DeleteDialogProps { kind: EntityKind; id: string; name: string; repository: FocusMindRepository; onClose: () => void; onDeleted: () => Promise<void> }
const emptyImpact: DeletionImpact = { themes: 0, goals: 0, tasks: 0, occurrences: 0, focusSessions: 0 }
const kindLabel: Record<EntityKind, string> = { theme: '主题', goal: '目标', task: '任务' }

export function DeleteDialog({ kind, id, name, repository, onClose, onDeleted }: DeleteDialogProps) {
  const [impact, setImpact] = useState<DeletionImpact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    let alive = true
    repository.countDeletionImpact(kind, id).then((next) => { if (alive) setImpact(next) }).catch((loadError: unknown) => { if (alive) setError(loadError instanceof Error ? loadError.message : '无法计算删除影响') })
    return () => { alive = false }
  }, [id, kind, repository])
  const counts = impact ?? emptyImpact
  async function confirmDelete() {
    setDeleting(true); setError(null)
    try { await repository.transaction(async (transaction) => transaction.deleteCascade(kind, id)); await onDeleted(); onClose() }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : '删除失败，请重试'); setDeleting(false) }
  }
  return <div className="dialog-backdrop" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}><section className="delete-dialog" role="dialog" aria-modal="true" aria-label={`确认删除${kindLabel[kind]}`}>
    <div className="danger-mark" aria-hidden="true">!</div><span className="eyebrow danger">永久操作</span><h2>删除“{name}”？</h2><p>此操作不可撤销，并会同时删除以下关联内容。</p>
    <div className="impact-grid" aria-label="删除影响"><span>主题 {counts.themes}</span><span>目标 {counts.goals}</span><span>任务 {counts.tasks}</span><span>实例 {counts.occurrences}</span><span>专注记录 {counts.focusSessions}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer className="dialog-actions"><button autoFocus className="button-secondary" type="button" onClick={onClose}>取消</button><button className="button-danger" type="button" disabled={impact === null || deleting} onClick={confirmDelete}>{deleting ? '删除中…' : '永久删除'}</button></footer>
  </section></div>
}
