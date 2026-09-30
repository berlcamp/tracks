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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus } from 'lucide-react'
import { FormField } from './sectors-panel'
import {
  addMembership, deleteInvite, inviteUser, revokeInvite, setUserStatus,
  updateRoleAssignment,
} from '@/app/actions/settings'
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
export function UsersPanel({ users, invites, departments, selfProfileId }: {
  users: UserRow[]
  invites: InviteRow[]
  departments: Department[]
  /** The administrator viewing the page, whose own rows offer no Edit. */
  selfProfileId: string
}) {
  const [open, setOpen] = useState(false)
  const [addingTo, setAddingTo] = useState<UserRow | null>(null)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [deleting, setDeleting] = useState<InviteRow | null>(null)
  const [pending, startTransition] = useTransition()
  const departmentCode = (id: string | null) =>
    id ? departments.find((d) => d.id === id)?.code ?? '—' : '—'

  const pendingInvites = invites.filter((invite) => invite.status === 'pending')

  // One row per office held, so a person with two offices is two rows. Sorted
  // by name so those rows sit together.
  const sortedUsers = [...users].sort((a, b) =>
    (a.profile?.full_name ?? '').localeCompare(b.profile?.full_name ?? '')
    || departmentCode(a.department_id).localeCompare(departmentCode(b.department_id)))

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            People who have signed in and been bound to a role — one row for each office
            they hold. Someone with several offices switches between them from the top of
            the sidebar. Deactivating takes effect on their very next request, not when
            their session expires.
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
              {sortedUsers.map((user) => (
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
                  <TableCell className="whitespace-nowrap text-right">
                    {user.profile && user.profile.id !== selfProfileId ? (
                      <Button
                        size="sm" variant="ghost" disabled={pending}
                        onClick={() => setEditing(user)}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {user.department_id && user.status === 'active' && user.profile ? (
                      <Button
                        size="sm" variant="ghost" disabled={pending}
                        onClick={() => setAddingTo(user)}
                      >
                        Add office
                      </Button>
                    ) : null}
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
                  <TableCell className="whitespace-nowrap text-right">
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
                    <Button
                      size="sm" variant="ghost" disabled={pending}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(invite)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <InviteDialog departments={departments} open={open} onOpenChange={setOpen} />
      <EditRoleDialog
        user={editing}
        held={users
          .filter((u) => u.profile?.id === editing?.profile?.id
            && u.id !== editing?.id && u.department_id)
          .map((u) => u.department_id as string)}
        departments={departments}
        onClose={() => setEditing(null)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(next) => { if (!next) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the invitation to {deleting?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed outright rather than kept on record as revoked. The address
              can no longer use it to sign in; you can invite them again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (!deleting) return
                startTransition(async () => {
                  const result = await deleteInvite(deleting.id)
                  if (result.ok) toast.success('Invitation deleted.')
                  else toast.error(result.error)
                  setDeleting(null)
                })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AddOfficeDialog
        user={addingTo}
        held={users
          .filter((u) => u.profile?.id === addingTo?.profile?.id && u.department_id)
          .map((u) => u.department_id as string)}
        departments={departments}
        onClose={() => setAddingTo(null)}
      />
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
              toast.success(result.data.added
                ? 'They already had access — the office has been added to theirs.'
                : 'Invitation created.')
              onOpenChange(false)
            })
          }}
        >
          <FormField label="Email" name="email" type="email" required
                     placeholder="name@bayugan.gov.ph" />
          <FormField label="Full name" name="fullName" required />

          <div className="grid gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsDepartment ? (
            <div className="grid gap-2">
              <Label htmlFor="invite-department">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="invite-department">
                  <SelectValue placeholder="Choose a department" />
                </SelectTrigger>
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
                If this address already has access, the office is added to the ones they
                hold rather than replacing them.
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

/**
 * Another office for somebody who already has access. Only department roles
 * are offered: a person holds office memberships or one city-wide role, and
 * the database refuses the mix.
 */
function AddOfficeDialog({ user, held, departments, onClose }: {
  user: UserRow | null
  held: string[]
  departments: Department[]
  onClose: () => void
}) {
  const [role, setRole] = useState<UserRole>('dept_encoder')
  const [departmentId, setDepartmentId] = useState<string>(NO_DEPARTMENT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const available = departments.filter((d) => d.active && !held.includes(d.id))

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(next) => {
        if (next) return
        setError(null)
        setDepartmentId(NO_DEPARTMENT)
        onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an office</DialogTitle>
          <DialogDescription>
            {user?.profile?.full_name} keeps the offices they hold and can switch to this
            one from the top of the sidebar.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!user?.profile) return
            setError(null)
            startTransition(async () => {
              const result = await addMembership({
                profileId: user.profile!.id,
                role,
                departmentId: departmentId === NO_DEPARTMENT ? '' : departmentId,
              })
              if (!result.ok) { setError(result.error); return }
              toast.success('Office added.')
              setDepartmentId(NO_DEPARTMENT)
              onClose()
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="add-office-department">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger id="add-office-department">
                <SelectValue placeholder="Choose a department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPARTMENT}>Choose a department</SelectItem>
                {available.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-office-role">Role in that office</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger id="add-office-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || departmentId === NO_DEPARTMENT}>
              {pending ? 'Adding…' : 'Add office'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Change what one row of the Access table grants. One row is one office, so
 * somebody with two offices keeps the other exactly as it was. Moving a person
 * between a department role and a city-wide one is refused by the database
 * while they hold another active office — the message says what to do.
 */
function EditRoleDialog({ user, held, departments, onClose }: {
  user: UserRow | null
  /** Offices this person holds on their OTHER rows, which this one cannot become. */
  held: string[]
  departments: Department[]
  onClose: () => void
}) {
  const [role, setRole] = useState<UserRole>('dept_encoder')
  const [departmentId, setDepartmentId] = useState<string>(NO_DEPARTMENT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Start from what the row grants now, each time a different row is opened.
  if (user && loadedFor !== user.id) {
    setLoadedFor(user.id)
    setRole(user.role)
    setDepartmentId(user.department_id ?? NO_DEPARTMENT)
    setError(null)
  }

  const close = () => { setLoadedFor(null); onClose() }
  const needsDepartment = DEPARTMENT_ROLES.includes(role)
  const available = departments.filter((d) =>
    (d.active || d.id === user?.department_id) && !held.includes(d.id))

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit access</DialogTitle>
          <DialogDescription>
            {user?.profile?.full_name} ({user?.profile?.email}). The change takes effect on
            their next request.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!user) return
            setError(null)
            startTransition(async () => {
              const result = await updateRoleAssignment({
                roleId: user.id,
                role,
                departmentId: needsDepartment && departmentId !== NO_DEPARTMENT
                  ? departmentId
                  : '',
              })
              if (!result.ok) { setError(result.error); return }
              toast.success('Access updated.')
              close()
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="edit-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger id="edit-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsDepartment ? (
            <div className="grid gap-2">
              <Label htmlFor="edit-department">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="edit-department">
                  <SelectValue placeholder="Choose a department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Choose a department</SelectItem>
                  {available.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button
              type="submit"
              disabled={pending || (needsDepartment && departmentId === NO_DEPARTMENT)}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
