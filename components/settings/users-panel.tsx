'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Plus } from 'lucide-react'
import { FormField } from './sectors-panel'
import { inviteUser, revokeInvite, setUserStatus } from '@/app/actions/settings'
import { ROLE_LABELS } from '@/lib/auth/permissions'
import type { Department, UserRole } from '@/types/tracks'

interface UserRow {
  id: string
  role: UserRole
  status: 'active' | 'inactive'
  department_id: string | null
  profile: { id: string; email: string; full_name: string } | null
}

interface InviteRow {
  id: string
  email: string
  full_name: string
  role: UserRole
  department_id: string | null
  status: string
  expires_at: string
}

const ROLES = Object.keys(ROLE_LABELS) as UserRole[]
const DEPARTMENT_ROLES: UserRole[] = ['dept_encoder', 'dept_head']
const NO_DEPARTMENT = '__none__'

/**
 * Access is invite-first. There is no "create user" here and there cannot be:
 * the account is minted by Google, and tracks.claim_invite() binds it to this
 * invitation on first sign-in. Until then the address reaches nothing.
 */
export function UsersPanel({ users, invites, departments }: {
  users: UserRow[]
  invites: InviteRow[]
  departments: Department[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const departmentCode = (id: string | null) =>
    id ? departments.find((d) => d.id === id)?.code ?? '—' : '—'

  const pendingInvites = invites.filter((invite) => invite.status === 'pending')

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            People who have signed in and been bound to a role. Deactivating takes effect
            on their very next request, not when their session expires.
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Invite someone
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Nobody has signed in yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.profile?.full_name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{user.profile?.email ?? '—'}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                  <TableCell>{departmentCode(user.department_id)}</TableCell>
                  <TableCell>
                    <Badge variant={user.status === 'active' ? 'secondary' : 'outline'}>
                      {user.status === 'active' ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm" variant="ghost" disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const next = user.status === 'active' ? 'inactive' : 'active'
                          const result = await setUserStatus(user.id, next)
                          if (result.ok) toast.success(next === 'active' ? 'Reactivated.' : 'Deactivated.')
                          else toast.error(result.error)
                        })}
                    >
                      {user.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium">Pending invitations</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingInvites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No invitations outstanding.
                  </TableCell>
                </TableRow>
              ) : null}
              {pendingInvites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-medium">{invite.email}</TableCell>
                  <TableCell>{invite.full_name}</TableCell>
                  <TableCell>{ROLE_LABELS[invite.role]}</TableCell>
                  <TableCell>{departmentCode(invite.department_id)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {invite.expires_at.slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm" variant="ghost" disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await revokeInvite(invite.id)
                          if (result.ok) toast.success('Revoked.')
                          else toast.error(result.error)
                        })}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <InviteDialog departments={departments} open={open} onOpenChange={setOpen} />
    </div>
  )
}

function InviteDialog({ departments, open, onOpenChange }: {
  departments: Department[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [role, setRole] = useState<UserRole>('dept_encoder')
  const [departmentId, setDepartmentId] = useState<string>(NO_DEPARTMENT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const needsDepartment = DEPARTMENT_ROLES.includes(role)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setError(null); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            The invitation is claimed on their first Google sign-in with this exact address.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            const form = new FormData(event.currentTarget)
            startTransition(async () => {
              const result = await inviteUser({
                email: String(form.get('email') ?? ''),
                fullName: String(form.get('fullName') ?? ''),
                role,
                departmentId: needsDepartment && departmentId !== NO_DEPARTMENT
                  ? departmentId
                  : '',
              })
              if (!result.ok) { setError(result.error); return }
              toast.success('Invitation created.')
              onOpenChange(false)
            })
          }}
        >
          <FormField label="Email" name="email" type="email" required
                     placeholder="name@bayugan.gov.ph" />
          <FormField label="Full name" name="fullName" required />

          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsDepartment ? (
            <div className="grid gap-2">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Choose a department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Choose a department</SelectItem>
                  {departments.filter((d) => d.active).map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A person belongs to exactly one department.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This is a city-wide role and is not tied to a department.
            </p>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>{pending ? 'Inviting…' : 'Send invitation'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
