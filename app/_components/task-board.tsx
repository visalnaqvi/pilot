'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { SearchPicker } from './search-picker'

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'closed'
type TaskType = 'basic' | 'submission'
type DateValue = { toDate: () => Date }
type Assignee = { userId: string; userName: string; userEmail: string }
type Member = { userId: string; userName?: string; userEmail: string; status?: string }
type DirectoryUser = { name?: string; email?: string; role?: string }
type Group = { id: string; name: string; members: Member[] }
type Task = {
  id: string
  organisationId: string
  title: string
  description: string
  taskType?: TaskType
  sourceType?: 'assignment'
  linkedAssignmentBatchId?: string
  linkedTestId?: string
  status: TaskStatus
  assignedUserIds: string[]
  assignedUsers?: Assignee[]
  assignedGroupIds?: string[]
  audienceNames?: string[]
  organisationName?: string
  createdByName?: string
  attachments?: TaskAttachment[]
  isClosed?: boolean
  closedAt?: DateValue
  closedByName?: string
  startAt?: DateValue | null
  endAt?: DateValue | null
  createdAt?: DateValue
  updatedAt?: DateValue
  statusUpdatedAt?: DateValue
  lastCommentAt?: DateValue
  lastCommentPreview?: string
}
type TaskAttachment = {
  id: string
  name: string
  path: string
  size: number
  contentType: string
}
type AssigneeStatus = {
  userId: string
  status: TaskStatus
}
type TaskSubmission = {
  userId: string
  userName: string
  attachment: TaskAttachment
  submittedAt?: DateValue
}
type Comment = {
  id: string
  body: string
  authorId: string
  authorName: string
  authorRole: 'user' | 'organisation'
  createdAt?: DateValue
}

const stages: { id: TaskStatus; label: string; eyebrow: string; dot: string; count: string }[] = [
  { id: 'todo', label: 'To do', eyebrow: 'TO DO', dot: 'bg-slate-400', count: 'bg-slate-200 text-slate-700' },
  { id: 'in_progress', label: 'In progress', eyebrow: 'IN PROGRESS', dot: 'bg-blue-500', count: 'bg-blue-100 text-blue-700' },
  { id: 'done', label: 'Done', eyebrow: 'DONE', dot: 'bg-emerald-500', count: 'bg-emerald-100 text-emerald-700' },
  { id: 'closed', label: 'Closed', eyebrow: 'CLOSED', dot: 'bg-violet-500', count: 'bg-violet-100 text-violet-700' },
]
const workStages = stages.filter(stage => stage.id !== 'closed')

export function TaskBoard() {
  const { user, profile, isImpersonating } = useAuth()
  const role = profile?.role
  const canUseTasks = role === 'organisation' || role === 'user'
  const canCreate = role === 'organisation'
  const [tasks, setTasks] = useState<Task[]>([])
  const [assigneeStatuses, setAssigneeStatuses] = useState<Record<string, Record<string, TaskStatus>>>({})
  const [taskSubmissions, setTaskSubmissions] = useState<Record<string, Record<string, TaskSubmission>>>({})
  const [members, setMembers] = useState<Member[]>([])
  const [userDirectory, setUserDirectory] = useState<Record<string, DirectoryUser>>({})
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [comments, setComments] = useState<Comment[]>([])
  const [search, setSearch] = useState('')
  const [organisationFilter, setOrganisationFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [taskTypeFilter, setTaskTypeFilter] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [taskType, setTaskType] = useState<TaskType>('basic')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [movingId, setMovingId] = useState('')
  const [submittingId, setSubmittingId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const autoClosingTaskIds = useRef(new Set<string>())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!user || !canUseTasks) return
    const taskQuery = role === 'organisation'
      ? query(collection(db, 'tasks'), where('organisationId', '==', user.uid))
      : query(collection(db, 'tasks'), where('assignedUserIds', 'array-contains', user.uid))
    return onSnapshot(taskQuery, snapshot => {
      setTasks(snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }) as Task)
        .sort((a, b) => taskTime(b.createdAt) - taskTime(a.createdAt)))
    }, reason => setMessage(`Could not load tasks: ${reason.message}`))
  }, [canUseTasks, role, user])

  useEffect(() => {
    if (!user || !canUseTasks || isImpersonating) return
    const expired = tasks
      .filter(task => task.sourceType === 'assignment' && !task.isClosed && taskTime(task.endAt || undefined) > 0 && taskTime(task.endAt || undefined) <= now && !autoClosingTaskIds.current.has(task.id))
      .slice(0, 400)
    if (!expired.length) return
    expired.forEach(task => autoClosingTaskIds.current.add(task.id))
    const batch = writeBatch(db)
    expired.forEach(task => batch.update(doc(db, 'tasks', task.id), {
      isClosed: true,
      updatedAt: serverTimestamp(),
      closedAt: serverTimestamp(),
      closedBy: 'system',
      closedByName: 'Deadline',
    }))
    void batch.commit().catch(reason => setMessage(reason instanceof Error ? `Could not close expired assignment tasks: ${reason.message}` : 'Could not close expired assignment tasks.'))
  }, [canUseTasks, isImpersonating, now, tasks, user])

  const taskIds = tasks.map(task => task.id).join('|')
  useEffect(() => {
    if (!user || !canUseTasks || !taskIds) return
    const stops = tasks.map(task => {
      if (role === 'user') {
        const stopStatus = onSnapshot(doc(db, 'tasks', task.id, 'assignees', user.uid), snapshot => {
          setAssigneeStatuses(current => ({
            ...current,
            [task.id]: {
              ...current[task.id],
              [user.uid]: snapshot.exists() ? (snapshot.data() as AssigneeStatus).status : task.status,
            },
          }))
        })
        const stopSubmission = onSnapshot(doc(db, 'tasks', task.id, 'submissions', user.uid), snapshot => {
          setTaskSubmissions(current => {
            const nextTask = { ...current[task.id] }
            if (snapshot.exists()) nextTask[user.uid] = snapshot.data() as TaskSubmission
            else delete nextTask[user.uid]
            return { ...current, [task.id]: nextTask }
          })
        })
        return () => { stopStatus(); stopSubmission() }
      }
      const stopStatus = onSnapshot(collection(db, 'tasks', task.id, 'assignees'), snapshot => {
        setAssigneeStatuses(current => ({
          ...current,
          [task.id]: Object.fromEntries(snapshot.docs.map(item => {
            const state = item.data() as AssigneeStatus
            return [state.userId, state.status]
          })),
        }))
      })
      const stopSubmissions = onSnapshot(collection(db, 'tasks', task.id, 'submissions'), snapshot => {
        setTaskSubmissions(current => ({
          ...current,
          [task.id]: Object.fromEntries(snapshot.docs.map(item => {
            const submission = item.data() as TaskSubmission
            return [submission.userId, submission]
          })),
        }))
      })
      return () => { stopStatus(); stopSubmissions() }
    })
    return () => stops.forEach(stop => stop())
    // taskIds intentionally represents the task subscription set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseTasks, role, taskIds, user])

  useEffect(() => {
    if (!user || !canCreate) return
    return onSnapshot(
      query(collection(db, 'organisationInvites'), where('organisationId', '==', user.uid)),
      snapshot => setMembers(snapshot.docs
        .map(item => item.data() as Member)
        .filter(member => member.status === 'accepted')
        .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)))),
      reason => setMessage(`Could not load institute students: ${reason.message}`),
    )
  }, [canCreate, user])

  useEffect(() => {
    if (!user || !canCreate) return
    return onSnapshot(collection(db, 'users'), snapshot => {
      setUserDirectory(Object.fromEntries(snapshot.docs
        .map(item => [item.id, item.data() as DirectoryUser] as const)
        .filter(([, account]) => account.role === 'user')))
    }, reason => setMessage(`Could not load student names: ${reason.message}`))
  }, [canCreate, user])

  useEffect(() => {
    if (!user || !canCreate) return
    return onSnapshot(
      query(collection(db, 'organisationGroups'), where('organisationId', '==', user.uid)),
      snapshot => {
        void Promise.all(snapshot.docs.map(async item => {
          const memberSnapshot = await getDocs(collection(item.ref, 'members'))
          return {
            id: item.id,
            name: item.data().name as string,
            members: memberSnapshot.docs.map(member => member.data() as Member),
          }
        })).then(loaded => setGroups(loaded.sort((a, b) => a.name.localeCompare(b.name))))
          .catch(() => setMessage('Could not load institute batches.'))
      },
    )
  }, [canCreate, user])

  useEffect(() => {
    if (!selectedTaskId) return
    return onSnapshot(
      query(collection(db, 'tasks', selectedTaskId, 'comments'), orderBy('createdAt', 'asc')),
      snapshot => setComments(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as Comment)),
      reason => setMessage(`Could not load comments: ${reason.message}`),
    )
  }, [selectedTaskId])

  const selectedTask = tasks.find(task => task.id === selectedTaskId)

  const resolvedMembers = useMemo(() => members.map(member => {
    const account = userDirectory[member.userId]
    return {
      ...member,
      userName: account?.name?.trim() || member.userName,
      userEmail: account?.email || member.userEmail,
    }
  }).sort((a, b) => memberLabel(a).localeCompare(memberLabel(b))), [members, userDirectory])

  const chosenAssignees = useMemo(() => {
    const selected = new Map<string, Assignee>()
    groups.filter(group => selectedGroupIds.includes(group.id)).flatMap(group => group.members).forEach(member => {
      const directoryMember = resolvedMembers.find(item => item.userId === member.userId)
      selected.set(member.userId, {
        userId: member.userId,
        userName: directoryMember ? memberLabel(directoryMember) : memberLabel(member),
        userEmail: directoryMember?.userEmail || member.userEmail,
      })
    })
    resolvedMembers.filter(member => selectedUserIds.includes(member.userId)).forEach(member => {
      selected.set(member.userId, { userId: member.userId, userName: memberLabel(member), userEmail: member.userEmail })
    })
    return [...selected.values()]
  }, [groups, resolvedMembers, selectedGroupIds, selectedUserIds])

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return tasks.filter(task => {
      if (role === 'user' && task.sourceType !== 'assignment' && taskTime(task.startAt || undefined) > now) return false
      if (role === 'user' && organisationFilter && task.organisationId !== organisationFilter) return false
      if (role === 'organisation' && assigneeFilter && !task.assignedUserIds.includes(assigneeFilter)) return false
      if (role === 'organisation' && groupFilter && !task.assignedGroupIds?.includes(groupFilter)) return false
      if (taskTypeFilter === 'assignment' && task.sourceType !== 'assignment') return false
      if (taskTypeFilter && taskTypeFilter !== 'assignment' && (task.sourceType === 'assignment' || (task.taskType || 'basic') !== taskTypeFilter)) return false
      return !needle || `${task.title} ${task.description} ${task.organisationName || task.createdByName || ''} ${(task.audienceNames || []).join(' ')} ${(task.assignedUsers || []).map(item => `${item.userName} ${item.userEmail}`).join(' ')}`.toLowerCase().includes(needle)
    })
  }, [assigneeFilter, groupFilter, now, organisationFilter, role, search, taskTypeFilter, tasks])

  const organisationOptions = useMemo(() => [...new Map(tasks.map(task => [
    task.organisationId,
    { id: task.organisationId, label: task.organisationName || task.createdByName || 'Institute' },
  ])).values()].sort((a, b) => a.label.localeCompare(b.label)), [tasks])

  const assigneeOptions = useMemo(() => [...new Map(tasks.flatMap(task => (task.assignedUsers || []).map(assignee => [
    assignee.userId,
    { id: assignee.userId, label: assigneeDisplayName(assignee, resolvedMembers), detail: assignee.userEmail },
  ] as const))).values()].sort((a, b) => a.label.localeCompare(b.label)), [resolvedMembers, tasks])

  const groupOptions = useMemo(() => groups
    .map(group => ({ id: group.id, label: group.name, detail: `${group.members.length} member${group.members.length === 1 ? '' : 's'}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [groups])

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setTaskType('basic')
    setStartAt('')
    setEndAt('')
    setSelectedUserIds([])
    setSelectedGroupIds([])
    setFiles([])
    setFormOpen(false)
  }

  const statusForTask = (task: Task): TaskStatus => {
    if (task.isClosed || (task.sourceType === 'assignment' && taskTime(task.endAt || undefined) > 0 && taskTime(task.endAt || undefined) <= now)) return 'closed'
    if (role === 'user' && user) return assigneeStatuses[task.id]?.[user.uid] || task.status || 'todo'
    const statuses = task.assignedUserIds.map(userId => assigneeStatuses[task.id]?.[userId] || task.status || 'todo')
    if (statuses.length && statuses.every(status => status === 'done' || status === 'closed')) return 'done'
    if (statuses.some(status => status === 'in_progress' || status === 'done' || status === 'closed')) return 'in_progress'
    return 'todo'
  }

  const allUsersComplete = (task: Task) => task.assignedUserIds.every(assigneeId => {
    const status = assigneeStatuses[task.id]?.[assigneeId] || task.status || 'todo'
    return status === 'done' || status === 'closed'
  })
  const displayedStages = showClosed ? stages.filter(stage => stage.id === 'closed') : workStages
  const displayedTasks = visibleTasks.filter(task => showClosed ? statusForTask(task) === 'closed' : statusForTask(task) !== 'closed')

  async function createTask(event: FormEvent) {
    event.preventDefault()
    if (!user || !canCreate || !title.trim() || !description.trim() || !chosenAssignees.length) {
      setMessage('Add a title, description, and at least one assigned student or batch.')
      return
    }
    const startDate = startAt ? new Date(startAt) : null
    const endDate = endAt ? new Date(endAt) : null
    if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime()))) {
      setMessage('Enter valid start and end times.')
      return
    }
    if (startDate && endDate && endDate <= startDate) {
      setMessage('The end time must be after the start time.')
      return
    }
    if (endDate && endDate.getTime() <= now) {
      setMessage('The end time must be in the future.')
      return
    }
    setSaving(true)
    setMessage('')
    const uploadedAttachments: TaskAttachment[] = []
    try {
      const ref = doc(collection(db, 'tasks'))
      for (const file of files) {
        const id = crypto.randomUUID()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment'
        const path = `task-attachments/${user.uid}/${ref.id}/${id}-${safeName}`
        await uploadBytes(storageRef(storage, path), file, { contentType: file.type || 'application/octet-stream' })
        uploadedAttachments.push({ id, name: file.name, path, size: file.size, contentType: file.type || 'application/octet-stream' })
      }
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          taskId: ref.id,
          title: title.trim(),
          description: description.trim(),
          taskType,
          selectedUserIds,
          selectedGroupIds,
          startAt: startDate?.toISOString() || null,
          endAt: endDate?.toISOString() || null,
          attachments: uploadedAttachments,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Unable to create the task.')
      }
      resetForm()
      setMessage('Task created and added to To do.')
    } catch (reason) {
      await Promise.allSettled(uploadedAttachments.map(attachment => deleteObject(storageRef(storage, attachment.path))))
      setMessage(reason instanceof Error ? reason.message : 'Unable to create the task.')
    } finally {
      setSaving(false)
    }
  }

  async function moveTask(task: Task, status: TaskStatus, targetUserId?: string) {
    if (!user || movingId || task.isClosed) return
    if (role === 'user' && task.sourceType === 'assignment') {
      setMessage('Assignment task progress updates automatically when you start and submit the test.')
      return
    }
    if (role === 'user' && taskTime(task.startAt || undefined) > now) {
      setMessage('This task has not started yet.')
      return
    }
    if (role === 'user' && taskTime(task.endAt || undefined) > 0 && taskTime(task.endAt || undefined) <= now) {
      setMessage('The deadline has passed. Only the institute can change this task now.')
      return
    }
    const assigneeId = role === 'user' ? user.uid : targetUserId
    if (!assigneeId) return
    if ((task.taskType || 'basic') === 'submission' && status === 'done' && !taskSubmissions[task.id]?.[assigneeId]) {
      setMessage('A submission file is required before this task can move to Done.')
      return
    }
    const currentStatus = assigneeStatuses[task.id]?.[assigneeId] || task.status || 'todo'
    if (status === 'closed' && (role !== 'organisation' || currentStatus !== 'done')) {
      setMessage('Only the institute can close an individual task after that student reaches Done.')
      return
    }
    if (currentStatus === 'closed' && role !== 'organisation') return
    if (currentStatus === status) return
    const assignee = task.assignedUsers?.find(item => item.userId === assigneeId)
    const assigneeName = assignee?.userName || assignee?.userEmail || 'Assigned student'
    setMovingId(`${task.id}:${assigneeId}`)
    setMessage('')
    try {
      const batch = writeBatch(db)
      batch.set(doc(db, 'tasks', task.id, 'assignees', assigneeId), {
        userId: assigneeId,
        userName: assigneeName,
        userEmail: assignee?.userEmail || '',
        status,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: profile?.name || profile?.email || (role === 'organisation' ? 'Institute' : 'Student'),
      }, { merge: true })
      batch.update(doc(db, 'tasks', task.id), {
        updatedAt: serverTimestamp(),
        lastStatusAt: serverTimestamp(),
        lastStatus: status,
        lastStatusUserId: assigneeId,
        lastStatusUserName: assigneeName,
        lastStatusUpdatedBy: user.uid,
        lastStatusUpdatedByName: profile?.name || profile?.email || (role === 'organisation' ? 'Institute' : 'Student'),
      })
      await batch.commit()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to move the task.')
    } finally {
      setMovingId('')
    }
  }

  async function submitTaskFile(task: Task, file: File) {
    if (!user || role !== 'user' || task.isClosed || submittingId) return
    if (taskTime(task.startAt || undefined) > now) {
      setMessage('This task has not started yet.')
      return
    }
    if (taskTime(task.endAt || undefined) > 0 && taskTime(task.endAt || undefined) <= now) {
      setMessage('The deadline has passed. Submissions are frozen.')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage('The submission file must be 20 MB or smaller.')
      return
    }
    const assignee = task.assignedUsers?.find(item => item.userId === user.uid)
    const userName = profile?.name || assignee?.userName || profile?.email || 'Student'
    const id = crypto.randomUUID()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'submission'
    const path = `task-submissions/${task.organisationId}/${task.id}/${user.uid}/${id}-${safeName}`
    setSubmittingId(task.id)
    setMessage('')
    let uploaded = false
    try {
      await uploadBytes(storageRef(storage, path), file, { contentType: file.type || 'application/octet-stream' })
      uploaded = true
      const attachment: TaskAttachment = { id, name: file.name, path, size: file.size, contentType: file.type || 'application/octet-stream' }
      const batch = writeBatch(db)
      batch.set(doc(db, 'tasks', task.id, 'submissions', user.uid), {
        userId: user.uid,
        userName,
        userEmail: profile?.email || assignee?.userEmail || '',
        attachment,
        submittedAt: serverTimestamp(),
      })
      batch.set(doc(db, 'tasks', task.id, 'assignees', user.uid), {
        userId: user.uid,
        userName,
        userEmail: profile?.email || assignee?.userEmail || '',
        status: 'done',
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: userName,
      }, { merge: true })
      batch.update(doc(db, 'tasks', task.id), {
        updatedAt: serverTimestamp(),
        lastStatusAt: serverTimestamp(),
        lastStatus: 'done',
        lastStatusUserId: user.uid,
        lastStatusUserName: userName,
        lastStatusUpdatedBy: user.uid,
        lastStatusUpdatedByName: userName,
      })
      await batch.commit()
      setMessage('Submission uploaded and task moved to Done.')
    } catch (reason) {
      if (uploaded) await deleteObject(storageRef(storage, path)).catch(() => undefined)
      setMessage(reason instanceof Error ? reason.message : 'Unable to upload the submission.')
    } finally {
      setSubmittingId('')
    }
  }

  async function setTaskClosed(task: Task, closed: boolean) {
    if (!user || role !== 'organisation' || movingId) return
    if (closed && !allUsersComplete(task)) {
      setMessage('Every assigned student must be Done or individually Closed before the complete task can be closed.')
      return
    }
    setMovingId(`close:${task.id}`)
    setMessage('')
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'tasks', task.id), {
        isClosed: closed,
        updatedAt: serverTimestamp(),
        closedAt: closed ? serverTimestamp() : null,
        closedBy: user.uid,
        closedByName: profile?.name || profile?.email || 'Institute',
      })
      await batch.commit()
      setMessage(closed ? 'Task closed.' : 'Task reopened.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : `Unable to ${closed ? 'close' : 'reopen'} the task.`)
    } finally {
      setMovingId('')
    }
  }

  async function deleteTask() {
    if (!user || role !== 'organisation' || !deleteTarget || deleteConfirmation !== deleteTarget.title) return
    setDeleting(true)
    setMessage('')
    try {
      const taskRef = doc(db, 'tasks', deleteTarget.id)
      const [assigneeSnapshot, commentSnapshot, submissionSnapshot] = await Promise.all([
        getDocs(collection(taskRef, 'assignees')),
        getDocs(collection(taskRef, 'comments')),
        getDocs(collection(taskRef, 'submissions')),
      ])
      const childDocuments = [...assigneeSnapshot.docs, ...commentSnapshot.docs, ...submissionSnapshot.docs]
      const submissionAttachments = submissionSnapshot.docs
        .map(item => (item.data() as TaskSubmission).attachment)
        .filter((attachment): attachment is TaskAttachment => Boolean(attachment?.path))
      for (let index = 0; index < childDocuments.length; index += 400) {
        const batch = writeBatch(db)
        childDocuments.slice(index, index + 400).forEach(item => batch.delete(item.ref))
        await batch.commit()
      }
      await deleteDoc(taskRef)
      const cleanup = await Promise.allSettled([...(deleteTarget.attachments || []), ...submissionAttachments].map(attachment => deleteObject(storageRef(storage, attachment.path))))
      const cleanupFailed = cleanup.some(result => result.status === 'rejected' && !(result.reason instanceof Error && 'code' in result.reason && result.reason.code === 'storage/object-not-found'))
      const deletedTitle = deleteTarget.title
      setSelectedTaskId('')
      setComments([])
      setDeleteTarget(null)
      setDeleteConfirmation('')
      setMessage(cleanupFailed ? `“${deletedTitle}” was deleted, but one or more attachment files could not be cleaned up.` : `“${deletedTitle}” and its attachments were deleted.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to delete the task.')
    } finally {
      setDeleting(false)
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault()
    if (!user || !selectedTask || !comment.trim()) return
    setSaving(true)
    setMessage('')
    try {
      const body = comment.trim()
      const authorName = profile?.name || profile?.email || (role === 'organisation' ? 'Institute' : 'Student')
      const batch = writeBatch(db)
      const commentRef = doc(collection(db, 'tasks', selectedTask.id, 'comments'))
      batch.set(commentRef, {
        body,
        authorId: user.uid,
        authorName,
        authorRole: role,
        createdAt: serverTimestamp(),
      })
      batch.update(doc(db, 'tasks', selectedTask.id), {
        updatedAt: serverTimestamp(),
        lastCommentAt: serverTimestamp(),
        lastCommentAuthorId: user.uid,
        lastCommentAuthorName: authorName,
        lastCommentPreview: body.slice(0, 140),
      })
      await batch.commit()
      setComment('')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to add the comment.')
    } finally {
      setSaving(false)
    }
  }

  if (!canUseTasks) return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Tasks are available to institute and student accounts.</p></section>

  return <section className="mx-auto max-w-7xl">
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-bold tracking-widest text-indigo-600">{canCreate ? 'INSTITUTE WORKSPACE' : 'MY WORK'}</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">Tasks</h1>
        <p className="mt-2 text-slate-600">{canCreate ? 'Plan work, follow progress, and collaborate with assigned students.' : 'Only tasks assigned to you appear on this board.'}</p>
      </div>
      {canCreate && <button type="button" onClick={() => { setFormOpen(true); setMessage('') }} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700">+ Create task</button>}
    </header>

    <div className={`mt-7 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-2 lg:items-center ${role === 'organisation' ? 'xl:grid-cols-[minmax(0,1fr)_minmax(11rem,.4fr)_minmax(13rem,.5fr)_minmax(12rem,.45fr)_auto]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(12rem,.45fr)_minmax(14rem,.55fr)_auto]'}`}>
      <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
        <span aria-hidden="true" className="text-slate-400">⌕</span>
        <span className="sr-only">Search tasks</span>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tasks, students, or batches" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <SearchPicker value={taskTypeFilter} options={[{ id: '', label: 'All task types' }, { id: 'basic', label: 'Basic' }, { id: 'submission', label: 'Submission' }, { id: 'assignment', label: 'Assignment' }]} onChange={option => setTaskTypeFilter(option.id)} placeholder="Filter by task type" />
      {role === 'user'
        ? <SearchPicker value={organisationFilter} options={[{ id: '', label: 'All institutes', detail: `${organisationOptions.length} institutes` }, ...organisationOptions]} onChange={option => setOrganisationFilter(option.id)} placeholder="Filter by institute" />
        : <SearchPicker value={assigneeFilter} options={[{ id: '', label: 'All students', detail: `${assigneeOptions.length} students` }, ...assigneeOptions]} onChange={option => setAssigneeFilter(option.id)} placeholder="Search and filter by student" />}
      {role === 'organisation' && <SearchPicker value={groupFilter} options={[{ id: '', label: 'All batches', detail: `${groupOptions.length} batches` }, ...groupOptions]} onChange={option => setGroupFilter(option.id)} placeholder="Search and filter by batch" />}
      <div className="flex items-center justify-end gap-3">
        <p className="text-sm font-semibold text-slate-500">{displayedTasks.length} task{displayedTasks.length === 1 ? '' : 's'}</p>
        <button type="button" aria-pressed={showClosed} aria-label={showClosed ? 'Show active tasks' : 'Show closed tasks'} title={showClosed ? 'Show active tasks' : 'Show closed tasks'} onClick={() => setShowClosed(current => !current)} className={`grid h-10 w-10 place-items-center rounded-xl border text-lg font-black transition ${showClosed ? 'border-violet-300 bg-violet-100 text-violet-700 hover:bg-violet-200' : 'border-slate-300 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'}`}>
          <span aria-hidden="true">{showClosed ? '▦' : '✓'}</span>
        </button>
      </div>
    </div>

    {message && <p role="status" className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">{message}</p>}

    <div className={`mt-6 grid items-start gap-5 ${showClosed ? 'grid-cols-1' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
      {displayedStages.map(stage => {
        const stageTasks = displayedTasks.filter(task => statusForTask(task) === stage.id)
        return <section
          key={stage.id}
          aria-label={stage.label}
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault()
            if (role !== 'user' || !user || stage.id === 'closed') return
            const task = tasks.find(item => item.id === event.dataTransfer.getData('text/task-id'))
            if (task) void moveTask(task, stage.id, user.uid)
          }}
          className="min-h-64 rounded-2xl bg-slate-100/80 p-3 ring-1 ring-slate-200"
        >
          <header className="flex items-center gap-2 px-2 py-2">
            <span className={`h-2.5 w-2.5 rounded-full ${stage.dot}`} />
            <h2 className="text-xs font-black tracking-wider text-slate-700">{stage.eyebrow}</h2>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-black ${stage.count}`}>{stageTasks.length}</span>
          </header>
          <div className={showClosed ? 'mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'mt-2 space-y-3'}>
            {stageTasks.map(task => <TaskCard
              key={task.id}
              task={task}
              stageIndex={stages.findIndex(item => item.id === stage.id)}
              role={role}
              now={now}
              frozen={taskTime(task.endAt || undefined) > 0 && taskTime(task.endAt || undefined) <= now}
              aggregateStatuses={assigneeStatuses[task.id] || {}}
              moving={movingId.startsWith(`${task.id}:`)}
              open={() => setSelectedTaskId(task.id)}
            />)}
            {!stageTasks.length && <div className="grid min-h-32 place-items-center rounded-xl border-2 border-dashed border-slate-200 bg-white/60 p-4 text-center text-sm font-medium text-slate-400">{showClosed ? 'No closed tasks' : 'Drop tasks here'}</div>}
          </div>
        </section>
      })}
    </div>

    {!tasks.length && <div className="mt-6 rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center"><p className="text-lg font-black text-slate-800">{canCreate ? 'Create your first task' : 'No tasks assigned yet'}</p><p className="mt-2 text-sm text-slate-500">{canCreate ? 'Assign it to a student or batch and track it across the board.' : 'New tasks from your institutes will appear here.'}</p></div>}

    {formOpen && <CreateTaskDialog
      title={title}
      description={description}
      taskType={taskType}
      startAt={startAt}
      endAt={endAt}
      members={resolvedMembers}
      groups={groups}
      selectedUserIds={selectedUserIds}
      selectedGroupIds={selectedGroupIds}
      files={files}
      assigneeCount={chosenAssignees.length}
      saving={saving}
      setTitle={setTitle}
      setDescription={setDescription}
      setTaskType={setTaskType}
      setStartAt={setStartAt}
      setEndAt={setEndAt}
      toggleUser={id => setSelectedUserIds(current => toggleId(current, id))}
      toggleGroup={id => setSelectedGroupIds(current => toggleId(current, id))}
      setFiles={setFiles}
      save={createTask}
      close={resetForm}
    />}

    {selectedTask && <TaskDetailDialog
      task={selectedTask}
      comments={comments}
      role={role}
      currentUserId={user?.uid || ''}
      now={now}
      assigneeStatuses={assigneeStatuses[selectedTask.id] || {}}
      submissions={taskSubmissions[selectedTask.id] || {}}
      userFrozen={role === 'user' && taskTime(selectedTask.endAt || undefined) > 0 && taskTime(selectedTask.endAt || undefined) <= now}
      memberDirectory={resolvedMembers}
      comment={comment}
      saving={saving}
      movingId={movingId}
      setComment={setComment}
      move={(status, assigneeId) => void moveTask(selectedTask, status, assigneeId)}
      addComment={addComment}
      submitFile={file => void submitTaskFile(selectedTask, file)}
      submitting={submittingId === selectedTask.id}
      toggleClosed={closed => void setTaskClosed(selectedTask, closed)}
      requestDelete={() => { setDeleteTarget(selectedTask); setDeleteConfirmation('') }}
      close={() => { setSelectedTaskId(''); setComments([]); setComment('') }}
    />}
    {deleteTarget && <DeleteTaskDialog
      task={deleteTarget}
      confirmation={deleteConfirmation}
      setConfirmation={setDeleteConfirmation}
      deleting={deleting}
      confirm={() => void deleteTask()}
      close={() => { if (!deleting) { setDeleteTarget(null); setDeleteConfirmation('') } }}
    />}
  </section>
}

function TaskCard({ task, stageIndex, role, now, frozen, aggregateStatuses, moving, open }: { task: Task; stageIndex: number; role?: string; now: number; frozen: boolean; aggregateStatuses: Record<string, TaskStatus>; moving: boolean; open: () => void }) {
  const doneCount = task.assignedUserIds.filter(userId => ['done', 'closed'].includes(aggregateStatuses[userId] || task.status)).length
  const canMove = role === 'user' && task.sourceType !== 'assignment' && !task.isClosed && !frozen && stages[stageIndex]?.id !== 'closed'
  const startsAt = taskTime(task.startAt || undefined)
  const upcoming = task.sourceType === 'assignment' && startsAt > now
  const remaining = taskTime(task.endAt || undefined) - now
  const urgency = task.sourceType !== 'assignment'
    ? 'border-slate-200 bg-white'
    : upcoming
      ? 'border-sky-200 border-l-sky-400 bg-white'
      : frozen
        ? 'border-slate-200 border-l-violet-400 bg-slate-50'
        : remaining <= 6 * 3_600_000
          ? 'border-slate-200 border-l-rose-400 bg-white'
          : remaining <= 24 * 3_600_000
            ? 'border-slate-200 border-l-orange-400 bg-white'
            : remaining <= 3 * 86_400_000
              ? 'border-slate-200 border-l-amber-400 bg-white'
              : 'border-slate-200 border-l-indigo-400 bg-white'
  const countdownStyle = remaining <= 6 * 3_600_000
    ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
    : remaining <= 24 * 3_600_000
      ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
      : remaining <= 3 * 86_400_000
        ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
        : 'bg-emerald-50 text-emerald-700'
  return <article
    draggable={canMove && !moving}
    onDragStart={event => {
      event.dataTransfer.setData('text/task-id', task.id)
      event.dataTransfer.effectAllowed = 'move'
    }}
    className={`rounded-xl border border-l-2 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${urgency} ${moving ? 'opacity-60' : ''}`}
  >
    <button type="button" onClick={open} className="block w-full text-left">
      <h3 className="font-black leading-6 text-slate-900">{task.title}</h3>
      {role === 'user' && <p className="mt-1 text-xs font-bold text-indigo-600">{task.organisationName || task.createdByName || 'Institute'}</p>}
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">{task.description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {task.sourceType === 'assignment' && <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-black text-indigo-700">Assignment</span>}
        {upcoming && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700">Upcoming</span>}
        {task.taskType === 'submission' && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700">Submission</span>}
        {frozen && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-700">Deadline passed</span>}
        {!upcoming && !frozen && task.endAt && <span title={`Deadline: ${formatDate(task.endAt, true)}`} className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-black ${countdownStyle}`}>⏱ {formatTimeRemaining(taskTime(task.endAt), now)}</span>}
        {upcoming && task.startAt && <span title={`Starts: ${formatDate(task.startAt, true)}`} className="rounded-full bg-sky-100 px-2.5 py-1 font-mono text-[11px] font-black text-sky-800">Starts in {formatTimeRemaining(startsAt, now)}</span>}
        {!frozen && task.endAt && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">Due {formatDate(task.endAt)}</span>}
        {(role === 'organisation' || upcoming) && task.startAt && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">Starts {formatDate(task.startAt)}</span>}
        {(task.audienceNames || []).slice(0, 2).map(name => <span key={name} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">{name}</span>)}
        {(task.audienceNames || []).length > 2 && <span className="text-xs font-bold text-slate-400">+{(task.audienceNames || []).length - 2}</span>}
        {!!task.attachments?.length && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">📎 {task.attachments.length}</span>}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-xs font-semibold text-slate-400">{role === 'organisation' ? `${doneCount}/${task.assignedUserIds.length} done` : formatDate(task.updatedAt || task.createdAt)}</span>
        <span className="flex -space-x-1.5">{(task.assignedUsers || []).slice(0, 3).map(assignee => <Initial key={assignee.userId} name={assignee.userName} />)}{task.assignedUserIds.length > 3 && <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-black text-slate-600">+{task.assignedUserIds.length - 3}</span>}</span>
      </div>
    </button>
  </article>
}

function CreateTaskDialog(props: {
  title: string
  description: string
  taskType: TaskType
  startAt: string
  endAt: string
  members: Member[]
  groups: Group[]
  selectedUserIds: string[]
  selectedGroupIds: string[]
  files: File[]
  assigneeCount: number
  saving: boolean
  setTitle: (value: string) => void
  setDescription: (value: string) => void
  setTaskType: (value: TaskType) => void
  setStartAt: (value: string) => void
  setEndAt: (value: string) => void
  toggleUser: (id: string) => void
  toggleGroup: (id: string) => void
  setFiles: (files: File[]) => void
  save: (event: FormEvent) => void
  close: () => void
}) {
  const [fileError, setFileError] = useState('')
  const [batchSearch, setBatchSearch] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const normalizedBatchSearch = batchSearch.trim().toLowerCase()
  const normalizedStudentSearch = studentSearch.trim().toLowerCase()
  const visibleGroups = props.groups.filter(group => group.name.toLowerCase().includes(normalizedBatchSearch))
  const visibleMembers = props.members.filter(member => (
    memberLabel(member).toLowerCase().includes(normalizedStudentSearch)
    || member.userEmail.toLowerCase().includes(normalizedStudentSearch)
  ))
  const chooseFiles = (selected: File[]) => {
    const combined = [...props.files, ...selected]
    if (combined.length > 10) {
      setFileError('You can attach up to 10 files.')
      return
    }
    if (selected.some(file => file.size > 20 * 1024 * 1024)) {
      setFileError('Each attachment must be 20 MB or smaller.')
      return
    }
    props.setFiles(combined)
    setFileError('')
  }
  return <div role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/55 p-4" onMouseDown={props.close}>
    <form onSubmit={props.save} onMouseDown={event => event.stopPropagation()} className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
        <div><p className="text-xs font-black tracking-widest text-indigo-600">NEW TASK</p><h2 id="create-task-title" className="mt-1 text-2xl font-black">Create a task</h2></div>
        <button type="button" onClick={props.close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
      </header>
      <div className="space-y-6 p-6">
        <label className="block text-sm font-bold text-slate-800">Title <span className="text-rose-500">*</span><input autoFocus required value={props.title} onChange={event => props.setTitle(event.target.value)} placeholder="e.g. Review quantitative aptitude notes" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
        <fieldset>
          <legend className="text-sm font-bold text-slate-800">Task type <span className="text-rose-500">*</span></legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Choice checked={props.taskType === 'basic'} label="Basic" detail="Students move the task through every stage themselves." onChange={() => props.setTaskType('basic')} type="radio" />
            <Choice checked={props.taskType === 'submission'} label="Submission" detail="A file upload is required before a student can complete the task." onChange={() => props.setTaskType('submission')} type="radio" />
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-bold text-slate-800">Schedule</legend>
          <p className="mt-1 text-xs text-slate-500">Students see the task at the start time. Their status and submissions freeze at the end time.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-slate-800">Start time <span className="font-normal text-slate-400">(optional)</span><input type="datetime-local" value={props.startAt} onChange={event => props.setStartAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
            <label className="block text-sm font-bold text-slate-800">End time <span className="font-normal text-slate-400">(optional)</span><input type="datetime-local" value={props.endAt} min={props.startAt || undefined} onChange={event => props.setEndAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
          </div>
        </fieldset>
        <label className="block text-sm font-bold text-slate-800">Description <span className="text-rose-500">*</span><textarea required rows={5} value={props.description} onChange={event => props.setDescription(event.target.value)} placeholder="Add the context and expected outcome…" className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 font-normal leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
        <fieldset>
          <legend className="text-sm font-bold text-slate-800">Attachments</legend>
          <p className="mt-1 text-xs text-slate-500">Add up to 10 files, with a maximum size of 20 MB each. Every assignee can download them.</p>
          <label className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm font-bold text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50">
            <input type="file" multiple className="sr-only" onChange={event => { chooseFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
            + Choose files
          </label>
          {fileError && <p className="mt-2 text-sm font-semibold text-rose-600">{fileError}</p>}
          {!!props.files.length && <div className="mt-3 divide-y rounded-xl border border-slate-200 bg-white">{props.files.map((file, index) => <div key={`${file.name}:${file.size}:${index}`} className="flex items-center gap-3 px-4 py-3"><span aria-hidden="true">📎</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{file.name}</p><p className="mt-0.5 text-xs text-slate-500">{formatFileSize(file.size)}</p></div><button type="button" onClick={() => props.setFiles(props.files.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-bold text-rose-600 hover:underline">Remove</button></div>)}</div>}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-bold text-slate-800">Assign to batches</legend>
          <p className="mt-1 text-xs text-slate-500">Every current member of a selected batch receives the task.</p>
          <input type="search" value={batchSearch} onChange={event => setBatchSearch(event.target.value)} placeholder="Search batches by name" aria-label="Search batches" className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {visibleGroups.map(group => <Choice key={group.id} checked={props.selectedGroupIds.includes(group.id)} label={group.name} detail={`${group.members.length} member${group.members.length === 1 ? '' : 's'}`} onChange={() => props.toggleGroup(group.id)} />)}
            {!props.groups.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No batches available. You can assign students directly below.</p>}
            {!!props.groups.length && !visibleGroups.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No batches match your search.</p>}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-bold text-slate-800">Assign to students</legend>
          <p className="mt-1 text-xs text-slate-500">Choose individual joined students, with or without a batch.</p>
          <input type="search" value={studentSearch} onChange={event => setStudentSearch(event.target.value)} placeholder="Search students by name or email" aria-label="Search students" className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          <div className="mt-3 grid max-h-64 gap-3 overflow-auto pr-1 sm:grid-cols-2">
            {visibleMembers.map(member => <Choice key={member.userId} checked={props.selectedUserIds.includes(member.userId)} label={memberLabel(member)} detail={member.userEmail} onChange={() => props.toggleUser(member.userId)} />)}
            {!props.members.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Invite students to your institute before assigning tasks.</p>}
            {!!props.members.length && !visibleMembers.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No students match your search.</p>}
          </div>
        </fieldset>
      </div>
      <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-slate-200 bg-white px-6 py-5">
        <p className="text-sm font-bold text-slate-600">{props.assigneeCount} unique assignee{props.assigneeCount === 1 ? '' : 's'}</p>
        <div className="flex gap-3"><button type="button" onClick={props.close} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700">Cancel</button><button disabled={props.saving || !props.assigneeCount} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{props.saving ? 'Creating…' : 'Create task'}</button></div>
      </footer>
    </form>
  </div>
}

function TaskDetailDialog({ task, comments, role, currentUserId, now, assigneeStatuses, submissions, userFrozen, memberDirectory, comment, saving, movingId, setComment, move, addComment, submitFile, submitting, toggleClosed, requestDelete, close }: {
  task: Task
  comments: Comment[]
  role?: string
  currentUserId: string
  now: number
  assigneeStatuses: Record<string, TaskStatus>
  submissions: Record<string, TaskSubmission>
  userFrozen: boolean
  memberDirectory: Member[]
  comment: string
  saving: boolean
  movingId: string
  setComment: (value: string) => void
  move: (status: TaskStatus, assigneeId: string) => void
  addComment: (event: FormEvent) => void
  submitFile: (file: File) => void
  submitting: boolean
  toggleClosed: (closed: boolean) => void
  requestDelete: () => void
  close: () => void
}) {
  const [downloadingPath, setDownloadingPath] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [assigneeStatusFilter, setAssigneeStatusFilter] = useState<TaskStatus | ''>('')
  const userStatus = assigneeStatuses[currentUserId] || task.status || 'todo'
  const userNotStarted = role === 'user' && taskTime(task.startAt || undefined) > now
  const allAssigneesComplete = task.assignedUserIds.every(assigneeId => {
    const status = assigneeStatuses[assigneeId] || task.status || 'todo'
    return status === 'done' || status === 'closed'
  })
  const sortedAssignees = [...(task.assignedUsers || [])].sort((first, second) => {
    const firstStatus = assigneeStatuses[first.userId] || task.status || 'todo'
    const secondStatus = assigneeStatuses[second.userId] || task.status || 'todo'
    const firstRank = firstStatus === 'closed' ? 2 : submissions[first.userId] ? 0 : 1
    const secondRank = secondStatus === 'closed' ? 2 : submissions[second.userId] ? 0 : 1
    if (firstRank !== secondRank) return firstRank - secondRank
    if (firstRank === 0) return taskTime(submissions[second.userId]?.submittedAt) - taskTime(submissions[first.userId]?.submittedAt)
    return assigneeDisplayName(first, memberDirectory).localeCompare(assigneeDisplayName(second, memberDirectory))
  })
  const normalizedAssigneeSearch = assigneeSearch.trim().toLocaleLowerCase()
  const visibleAssignees = sortedAssignees.filter(assignee => {
    const status = assigneeStatuses[assignee.userId] || task.status || 'todo'
    const matchesStatus = !assigneeStatusFilter || status === assigneeStatusFilter
    const matchesSearch = !normalizedAssigneeSearch
      || assigneeDisplayName(assignee, memberDirectory).toLocaleLowerCase().includes(normalizedAssigneeSearch)
      || assignee.userEmail.toLocaleLowerCase().includes(normalizedAssigneeSearch)
    return matchesStatus && matchesSearch
  })
  const openAttachment = async (attachment: TaskAttachment) => {
    setDownloadingPath(attachment.path)
    setAttachmentError('')
    try {
      const url = await getDownloadURL(storageRef(storage, attachment.path))
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setAttachmentError(`Unable to download ${attachment.name}.`)
    } finally {
      setDownloadingPath('')
    }
  }
  return <div role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/55 p-4" onMouseDown={close}>
    <div onMouseDown={event => event.stopPropagation()} className="grid max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl lg:h-[92vh] lg:max-h-none lg:grid-cols-[minmax(0,1.5fr)_minmax(19rem,.85fr)] lg:overflow-hidden">
      <section className="min-h-0 p-6 sm:p-8 lg:overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-black tracking-widest text-indigo-600">TASK DETAILS</p><span className={`rounded-full px-2.5 py-1 text-[10px] font-black tracking-wide ${task.taskType === 'submission' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{task.taskType === 'submission' ? 'SUBMISSION' : 'BASIC'}</span>{task.isClosed && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black tracking-wide text-violet-700">CLOSED</span>}</div><h2 id="task-detail-title" className="mt-2 text-3xl font-black tracking-tight">{task.title}</h2></div>
          <button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
        </div>
        <div className="mt-6">
          <p className="text-xs font-black tracking-wider text-slate-400">DESCRIPTION</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{task.description}</p>
        </div>
        {!!task.attachments?.length && <div className="mt-7">
          <div className="flex items-center justify-between"><p className="text-xs font-black tracking-wider text-slate-400">ATTACHMENTS</p><span className="text-xs font-bold text-slate-400">{task.attachments.length}</span></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{task.attachments.map(attachment => <button key={attachment.id} type="button" disabled={downloadingPath === attachment.path} onClick={() => void openAttachment(attachment)} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60"><span aria-hidden="true" className="text-lg">📎</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-800">{attachment.name}</span><span className="mt-1 block text-xs text-slate-500">{downloadingPath === attachment.path ? 'Opening…' : formatFileSize(attachment.size)}</span></span><span className="text-xs font-black text-indigo-700">Download</span></button>)}</div>
          {attachmentError && <p className="mt-2 text-sm font-semibold text-rose-600">{attachmentError}</p>}
        </div>}
        <div className="mt-8">
          <div className="flex items-center justify-between"><h3 className="text-lg font-black">Comments</h3><span className="text-xs font-bold text-slate-400">{comments.length}</span></div>
          <div className="mt-4 space-y-4">
            {comments.map(item => <article key={item.id} className="flex gap-3"><Initial name={item.authorName} /><div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-slate-900">{item.authorName} <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">{item.authorRole}</span></p><time className="text-[11px] font-semibold text-slate-400">{formatDate(item.createdAt, true)}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p></div></article>)}
            {!comments.length && <p className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No comments yet. Start the conversation.</p>}
          </div>
          <form onSubmit={addComment} className="mt-5">
            <label className="sr-only" htmlFor="task-comment">Add a comment</label>
            <textarea id="task-comment" value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={5000} placeholder="Write a comment…" className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
            <div className="mt-2 flex justify-end"><button disabled={saving || !comment.trim()} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Adding…' : 'Add comment'}</button></div>
          </form>
        </div>
      </section>
      <aside className="min-h-0 border-t border-slate-200 bg-slate-50 p-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
        {task.isClosed
          ? <div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-black tracking-wider text-violet-700">CLOSED</p><p className="mt-1 text-sm text-violet-800">This task was closed by {task.closedByName || 'the institute'}.</p></div>
          : role === 'user' && userStatus === 'closed'
            ? <div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-black tracking-wider text-violet-700">YOUR TASK IS CLOSED</p><p className="mt-1 text-sm text-violet-800">The institute marked your individual task as closed.</p></div>
          : role === 'user' && <>
          {task.sourceType === 'assignment' && task.linkedTestId && <div className={`mb-5 rounded-xl border p-4 ${userNotStarted ? 'border-sky-200 bg-sky-50' : userFrozen ? 'border-slate-200 bg-slate-100' : 'border-indigo-200 bg-indigo-50'}`}>
            <p className={`text-xs font-black tracking-wider ${userNotStarted ? 'text-sky-700' : userFrozen ? 'text-slate-600' : 'text-indigo-700'}`}>{userNotStarted ? 'UPCOMING ASSIGNMENT' : userFrozen ? 'ASSIGNMENT ENDED' : 'ASSIGNMENT READY'}</p>
            <p className={`mt-1 text-sm leading-5 ${userNotStarted ? 'text-sky-800' : userFrozen ? 'text-slate-600' : 'text-indigo-800'}`}>{userNotStarted ? `You can start this assignment on ${formatDate(task.startAt || undefined, true)}.` : userFrozen ? 'The deadline has passed and this assignment can no longer be started.' : 'Open the assigned test here. Your task status updates automatically.'}</p>
            {userNotStarted
              ? <span aria-disabled="true" className="mt-3 block cursor-not-allowed rounded-lg bg-slate-300 px-4 py-3 text-center text-sm font-black text-slate-600">Starts {formatDate(task.startAt || undefined, true)}</span>
              : userFrozen
                ? <span aria-disabled="true" className="mt-3 block cursor-not-allowed rounded-lg bg-slate-300 px-4 py-3 text-center text-sm font-black text-slate-600">Assignment ended</span>
                : <Link href={`/tests/${task.linkedTestId}${task.linkedAssignmentBatchId ? `?assignment=${encodeURIComponent(task.linkedAssignmentBatchId)}` : ''}`} className="mt-3 block rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-black text-white shadow-sm hover:bg-indigo-700">{userStatus === 'in_progress' ? 'Continue assignment' : userStatus === 'done' ? 'Open assignment' : 'Start assignment'}</Link>}
          </div>}
          {userFrozen && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs font-black tracking-wider text-rose-700">DEADLINE PASSED</p><p className="mt-1 text-sm leading-5 text-rose-800">Your task is frozen. Only the institute can change its status now.</p></div>}
          <p className="text-xs font-black tracking-wider text-slate-400">YOUR STATUS</p>
          {task.sourceType === 'assignment' && <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-xs font-black tracking-wider text-indigo-700">AUTOMATIC PROGRESS</p><p className="mt-1 text-sm leading-5 text-indigo-800">This task moves to In progress when you start the assignment and to Done when you submit it.</p></div>}
          <select value={userStatus} disabled={userFrozen || task.sourceType === 'assignment' || movingId === `${task.id}:${currentUserId}`} onChange={event => move(event.target.value as TaskStatus, currentUserId)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400">
            {workStages.map(stage => <option key={stage.id} value={stage.id} disabled={task.taskType === 'submission' && stage.id === 'done' && !submissions[currentUserId]}>{stage.label}{task.taskType === 'submission' && stage.id === 'done' && !submissions[currentUserId] ? ' · File required' : ''}</option>)}
          </select>
          {task.taskType === 'submission' && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-black tracking-wider text-amber-800">REQUIRED SUBMISSION</p>
            {submissions[currentUserId]
              ? <button type="button" onClick={() => void openAttachment(submissions[currentUserId].attachment)} className="mt-2 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm font-bold text-amber-800 hover:bg-amber-100"><span className="block truncate">{submissions[currentUserId].attachment.name}</span><span className="mt-1 block text-xs font-medium text-amber-700">Submitted · Download file</span></button>
              : <><p className="mt-1 text-xs leading-5 text-amber-800">{userFrozen ? 'The deadline has passed and submissions are frozen.' : 'Upload one file to move this task to Done.'}</p><label className={`mt-3 block rounded-lg px-3 py-2.5 text-center text-sm font-black text-white ${userFrozen ? 'cursor-not-allowed bg-slate-400' : 'cursor-pointer bg-amber-600 hover:bg-amber-700'}`}><input type="file" className="sr-only" disabled={submitting || userFrozen} onChange={event => { const file = event.target.files?.[0]; if (file) submitFile(file); event.target.value = '' }} />{submitting ? 'Uploading…' : userFrozen ? 'Submission closed' : 'Upload & mark done'}</label></>}
          </div>}
          <div className="mt-7"><p className="text-xs font-black tracking-wider text-slate-400">INSTITUTE</p><p className="mt-2 text-sm font-bold text-indigo-700">{task.organisationName || task.createdByName || 'Institute'}</p></div>
        </>}
        {role === 'organisation' && <>
          <button type="button" disabled={movingId === `close:${task.id}` || (!task.isClosed && !allAssigneesComplete)} onClick={() => toggleClosed(!task.isClosed)} className={`w-full rounded-xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${task.isClosed ? 'border border-violet-300 bg-white text-violet-700 hover:bg-violet-50' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>{movingId === `close:${task.id}` ? 'Updating…' : task.isClosed ? 'Reopen complete task' : 'Close complete task'}</button>
          {!task.isClosed && !allAssigneesComplete && <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Available after every student is Done or individually Closed.</p>}
        </>}
        <div className="mt-7">
          <p className="text-xs font-black tracking-wider text-slate-400">{role === 'organisation' ? 'STUDENT PROGRESS' : 'ASSIGNEES'}</p>
          {role === 'organisation' && <div className="mt-3 grid gap-2">
            <label className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
              <span aria-hidden="true" className="text-slate-400">⌕</span>
              <span className="sr-only">Search students</span>
              <input value={assigneeSearch} onChange={event => setAssigneeSearch(event.target.value)} placeholder="Search name or email" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </label>
            <select aria-label="Filter students by status" value={assigneeStatusFilter} onChange={event => setAssigneeStatusFilter(event.target.value as TaskStatus | '')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
              <option value="">All statuses</option>
              {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
            </select>
            <p className="text-xs font-semibold text-slate-400">{visibleAssignees.length} of {sortedAssignees.length} students</p>
          </div>}
          <div className="mt-3 space-y-3">{visibleAssignees.map(assignee => {
            const displayName = assigneeDisplayName(assignee, memberDirectory)
            const assigneeStatus = assigneeStatuses[assignee.userId] || task.status || 'todo'
            return <div key={assignee.userId} className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_7rem] items-center gap-x-3 gap-y-2 ${role === 'organisation' ? 'rounded-xl border border-slate-200 bg-white p-3' : ''}`}>
              <Initial name={displayName} />
              <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{displayName}</p><p className="truncate text-xs text-slate-500">{assignee.userEmail}</p></div>
              {role === 'organisation' && <select aria-label={`Status for ${displayName}`} value={assigneeStatus} disabled={task.isClosed || movingId === `${task.id}:${assignee.userId}`} onChange={event => move(event.target.value as TaskStatus, assignee.userId)} className={`w-28 rounded-lg border px-2 py-2 text-xs font-bold outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 ${assigneeStatus === 'closed' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-300 bg-white'}`}>{stages.map(stage => <option key={stage.id} value={stage.id} disabled={(task.taskType === 'submission' && stage.id === 'done' && !submissions[assignee.userId]) || (stage.id === 'closed' && assigneeStatus !== 'done' && assigneeStatus !== 'closed')}>{stage.label}{stage.id === 'closed' && assigneeStatus !== 'done' && assigneeStatus !== 'closed' ? ' · Done required' : ''}</option>)}</select>}
              {role === 'organisation' && task.taskType === 'submission' && (submissions[assignee.userId] ? <button type="button" title={submissions[assignee.userId].attachment.name} onClick={() => void openAttachment(submissions[assignee.userId].attachment)} className="col-span-2 col-start-2 w-fit max-w-full whitespace-nowrap rounded-full bg-emerald-50 px-2 py-1 leading-none text-emerald-700 hover:bg-emerald-100"><span className="text-xs font-semibold">View submission</span></button> : <p className="col-span-2 col-start-2 text-xs font-semibold text-amber-600">Awaiting file</p>)}
            </div>
          })}
          {!visibleAssignees.length && <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm font-semibold text-slate-400">No students match these filters.</div>}
          </div>
        </div>
        {!!task.audienceNames?.length && <div className="mt-7"><p className="text-xs font-black tracking-wider text-slate-400">AUDIENCE</p><div className="mt-3 flex flex-wrap gap-2">{task.audienceNames.map(name => <span key={name} className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700">{name}</span>)}</div></div>}
        <dl className="mt-7 space-y-4 border-t border-slate-200 pt-6 text-sm">{task.startAt && <div><dt className="text-xs font-black tracking-wider text-slate-400">START TIME</dt><dd className="mt-1 font-semibold text-slate-700">{formatDate(task.startAt, true)}</dd></div>}{task.endAt && <div><dt className="text-xs font-black tracking-wider text-slate-400">DEADLINE</dt><dd className="mt-1 font-semibold text-slate-700">{formatDate(task.endAt, true)}</dd></div>}<div><dt className="text-xs font-black tracking-wider text-slate-400">CREATED</dt><dd className="mt-1 font-semibold text-slate-700">{formatDate(task.createdAt, true)}</dd></div><div><dt className="text-xs font-black tracking-wider text-slate-400">LAST UPDATED</dt><dd className="mt-1 font-semibold text-slate-700">{formatDate(task.updatedAt, true)}</dd></div></dl>
        {role === 'organisation' && <button type="button" onClick={requestDelete} className="mt-7 w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 hover:bg-rose-100">Delete task</button>}
      </aside>
    </div>
  </div>
}

function DeleteTaskDialog({ task, confirmation, setConfirmation, deleting, confirm, close }: {
  task: Task
  confirmation: string
  setConfirmation: (value: string) => void
  deleting: boolean
  confirm: () => void
  close: () => void
}) {
  const matches = confirmation === task.title
  return <div role="dialog" aria-modal="true" aria-labelledby="delete-task-title" className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4" onMouseDown={close}>
    <form onSubmit={event => { event.preventDefault(); if (matches && !deleting) confirm() }} onMouseDown={event => event.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-xl text-rose-700">!</span>
      <h2 id="delete-task-title" className="mt-5 text-2xl font-black text-slate-950">Delete task?</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">This permanently deletes the task, its comments, progress, {task.attachments?.length || 0} task attachment{task.attachments?.length === 1 ? '' : 's'}, and all student submission files. Type <strong className="text-slate-900">{task.title}</strong> to confirm.</p>
      <label className="mt-5 block text-sm font-bold text-slate-800">Task title<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" placeholder={task.title} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label>
      {confirmation && !matches && <p className="mt-2 text-sm font-semibold text-rose-600">The task title does not match.</p>}
      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" disabled={deleting} onClick={close} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button><button disabled={!matches || deleting} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{deleting ? 'Deleting…' : 'Delete task'}</button></div>
    </form>
  </div>
}

function Choice({ checked, label, detail, onChange, type = 'checkbox' }: { checked: boolean; label: string; detail: string; onChange: () => void; type?: 'checkbox' | 'radio' }) {
  return <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${checked ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 hover:bg-slate-50'}`}>
    <input type={type} checked={checked} onChange={onChange} className="mt-1 h-4 w-4 accent-indigo-600" />
    <span className="min-w-0"><span className="block truncate text-sm font-black text-slate-800">{label}</span><span className="mt-1 block truncate text-xs text-slate-500">{detail}</span></span>
  </label>
}

function Initial({ name }: { name: string }) {
  return <span title={name} className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-white bg-indigo-100 text-[10px] font-black uppercase text-indigo-700">{name.trim().charAt(0) || '?'}</span>
}

function toggleId(values: string[], id: string) {
  return values.includes(id) ? values.filter(item => item !== id) : [...values, id]
}

function memberLabel(member: Member) {
  return member.userName?.trim() || member.userEmail
}

function assigneeDisplayName(assignee: Assignee, directory: Member[]) {
  const directoryMember = directory.find(member => member.userId === assignee.userId)
  return directoryMember?.userName?.trim() || assignee.userName?.trim() || assignee.userEmail
}

function taskTime(value?: DateValue) {
  return value?.toDate().getTime() || 0
}

function formatDate(value?: DateValue, includeTime = false) {
  if (!value) return 'Just now'
  return value.toDate().toLocaleString(undefined, includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
}

function formatTimeRemaining(deadline: number, now: number) {
  const totalSeconds = Math.max(0, Math.floor((deadline - now) / 1_000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const clock = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
  return days ? `${days}d ${clock} left` : `${clock} left`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
