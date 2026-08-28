'use client'

import { useState, useTransition } from 'react'
import { FileText, Landmark, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { recordAipAction, signDocument } from '@/app/actions/aip-action'
import { ACTION_LABELS, STAGE_LABELS } from '@/lib/validations/aip-action'
import { createClient } from '@/lib/supabase/browser'

type Stage = keyof typeof STAGE_LABELS
type Action = keyof typeof ACTION_LABELS

export interface AipActionRow {
  id: string
  stage: Stage
  action: Action
  action_date: string | null
  reference_no: string | null
  remarks: string | null
  document_path: string | null
  created_at: string
}

const STAGES: Stage[] = ['ldc', 'mayor', 'council']

/**
 * What happened to the printed programme once it left the office.
 *
 * Behind a button rather than down the page: the trail is a thing you go and
 * look at a few times a year, and it sat between the finalise panel and the
 * grid, which is what people actually come to this screen for.
 *
 * One dialog with two views, not a dialog inside a dialog. Stacking two modals
 * to record a resolution means two overlays and two Escape presses, and it
 * leaves the page with two elements claiming the dialog role.
 */
export function PaperTrailButton({ periodId, actions, canRecord }: {
  periodId: string
  actions: AipActionRow[]
  canRecord: boolean
}) {
  const [open, setOpen] = useState(false)
  const [recording, setRecording] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => { setRecording(false); setOpen(true) }}>
        <Landmark className="size-4" /> Paper Trail
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => { if (!next) setRecording(false); setOpen(next) }}
      >
        <DialogContent className="sm:max-w-2xl">
          {recording ? (
            <RecordActionForm
              periodId={periodId}
              // Back to the trail rather than closing it: the entry just
              // recorded is the thing you want to see land.
              onDone={() => setRecording(false)}
            />
          ) : (
            <PaperTrailView
              actions={actions}
              canRecord={canRecord}
              onRecord={() => setRecording(true)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The three stages are shown even when nothing has been recorded against them,
 * because the gap is the information: an empty "City Council" row is how you see
 * the folder has not come back yet.
 */
function PaperTrailView({ actions, canRecord, onRecord }: {
  actions: AipActionRow[]
  canRecord: boolean
  onRecord: () => void
}) {
  async function openDocument(path: string) {
    const result = await signDocument(path)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Paper trail</DialogTitle>
        <DialogDescription>
          The printed programme with the LDC, the Mayor and the City Council. Record what
          the returned paper says.
        </DialogDescription>
      </DialogHeader>

      <ol className="flex flex-col gap-3">
        {STAGES.map((stage) => {
          const recorded = actions
            .filter((entry) => entry.stage === stage)
            .sort((a, b) => (b.action_date ?? '').localeCompare(a.action_date ?? ''))

          return (
            <li key={stage} className="rounded-md border border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{STAGE_LABELS[stage]}</span>
                {recorded.length === 0 ? (
                  <Badge variant="outline">Not yet returned</Badge>
                ) : (
                  <Badge variant="secondary">{ACTION_LABELS[recorded[0]!.action]}</Badge>
                )}
              </div>

              {recorded.map((entry) => (
                <div key={entry.id} className="mt-2 text-sm text-muted-foreground">
                  <p>
                    {entry.action_date ?? 'no date'}
                    {entry.reference_no ? ` · ${entry.reference_no}` : ''}
                  </p>
                  {entry.remarks ? <p className="mt-0.5">{entry.remarks}</p> : null}
                  {entry.document_path ? (
                    <Button variant="link" size="sm" className="h-auto px-0"
                            onClick={() => openDocument(entry.document_path!)}>
                      <FileText className="size-3.5" /> View the scan
                    </Button>
                  ) : null}
                </div>
              ))}
            </li>
          )
        })}
      </ol>

      {canRecord ? (
        <DialogFooter>
          <Button size="sm" onClick={onRecord}>
            <Plus className="size-4" /> Record what came back
          </Button>
        </DialogFooter>
      ) : null}
    </>
  )
}

/** The second view of the same dialog: what the returned paper says. */
function RecordActionForm({ periodId, onDone }: {
  periodId: string
  onDone: () => void
}) {
  const [stage, setStage] = useState<Stage>('ldc')
  const [action, setAction] = useState<Action>('endorsed')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pending, startTransition] = useTransition()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const file = form.get('document')

    let documentPath: string | null = null
    if (file instanceof File && file.size > 0) {
      setUploading(true)
      // Uploaded under the caller's own session, so the bucket's RLS decides.
      const supabase = createClient()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
      const path = `${periodId}/${stage}-${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('tracks-documents').upload(path, file, { upsert: false })
      setUploading(false)

      if (uploadError) {
        setError(`Could not attach the scan: ${uploadError.message}`)
        return
      }
      documentPath = path
    }

    startTransition(async () => {
      const result = await recordAipAction({
        periodId,
        stage,
        action,
        actionDate: String(form.get('actionDate') ?? ''),
        referenceNo: String(form.get('referenceNo') ?? ''),
        remarks: String(form.get('remarks') ?? ''),
        documentPath: documentPath ?? '',
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Recorded.')
      onDone()
    })
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Record what came back</DialogTitle>
          <DialogDescription>
            The resolution number and the scan, as they appear on the returned paper.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="stage">Body</Label>
              <Select value={stage} onValueChange={(value) => setStage(value as Stage)}>
                <SelectTrigger id="stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="action">What they did</Label>
              <Select value={action} onValueChange={(value) => setAction(value as Action)}>
                <SelectTrigger id="action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                    <SelectItem key={a} value={a}>{ACTION_LABELS[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="actionDate">Date on the paper</Label>
              <Input id="actionDate" name="actionDate" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="referenceNo">Resolution / ordinance no.</Label>
              <Input id="referenceNo" name="referenceNo" placeholder="Resolution No. 2026-115" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea id="remarks" name="remarks" rows={2}
                      placeholder="Approved as submitted." />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="document">Scan</Label>
            <Input id="document" name="document" type="file"
                   accept="application/pdf,image/png,image/jpeg,image/webp" />
            <p className="text-xs text-muted-foreground">
              Stored privately. Anyone in TRACKS can open it through a link that expires
              after five minutes.
            </p>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading}>
              {uploading ? 'Attaching…' : pending ? 'Saving…' : 'Record'}
            </Button>
          </DialogFooter>
        </form>
    </>
  )
}
