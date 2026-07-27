'use client'

import { ChangeEvent, CSSProperties, FormEvent, SyntheticEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth, type UserProfile } from './auth-context'

type OrganisationInvite = {
  id: string
  organisationId: string
  organisationEmail: string
  userId: string
  userEmail: string
  initiatedBy?: 'organisation' | 'user'
  status: 'pending' | 'accepted' | 'declined'
}

type ProfileForm = {
  name: string
  profilePhotoUrl: string
  logoUrl: string
  address: string
  contactNumbers: string
  googleMapsUrl: string
  instagramUrl: string
  facebookUrl: string
}

const emptyForm: ProfileForm = {
  name: '',
  profilePhotoUrl: '',
  logoUrl: '',
  address: '',
  contactNumbers: '',
  googleMapsUrl: '',
  instagramUrl: '',
  facebookUrl: '',
}

const profileFormFrom = (organisation: UserProfile): ProfileForm => ({
  name: organisation.name || '',
  profilePhotoUrl: organisation.profilePhotoUrl || '',
  logoUrl: organisation.logoUrl || '',
  address: organisation.address || '',
  contactNumbers: organisation.contactNumbers?.join('\n') || '',
  googleMapsUrl: organisation.googleMapsUrl || '',
  instagramUrl: organisation.instagramUrl || '',
  facebookUrl: organisation.facebookUrl || '',
})

const cleanUrl = (value?: string) => {
  if (!value) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export function OrganisationProfile({ organisationId }: { organisationId: string }) {
  const { user, profile } = useAuth()
  const [organisation, setOrganisation] = useState<UserProfile | null>(null)
  const [form, setForm] = useState<ProfileForm>(emptyForm)
  const [invite, setInvite] = useState<OrganisationInvite | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'profilePhotoUrl' | 'logoUrl' | ''>('')
  const [message, setMessage] = useState('')

  const isOwner = profile?.role === 'organisation' && profile.uid === organisationId
  const canJoin = profile?.role === 'user'

  useEffect(() => onSnapshot(
    doc(db, 'users', organisationId),
    snapshot => {
      const loaded = snapshot.exists() ? ({ uid: snapshot.id, ...snapshot.data() } as UserProfile) : null
      setOrganisation(loaded?.role === 'organisation' ? loaded : null)
      if (loaded?.role === 'organisation') {
        setForm(current => editing
          ? { ...current, profilePhotoUrl: loaded.profilePhotoUrl || '', logoUrl: loaded.logoUrl || '' }
          : profileFormFrom(loaded))
      }
      setLoading(false)
    },
    reason => {
      setMessage(`Could not load this institute: ${reason.message}`)
      setLoading(false)
    },
  ), [editing, organisationId])

  useEffect(() => {
    if (!user || !canJoin) return
    return onSnapshot(
      query(collection(db, 'organisationInvites'), where('userId', '==', user.uid)),
      snapshot => {
        const membership = snapshot.docs
          .map(item => ({ id: item.id, ...item.data() }) as OrganisationInvite)
          .find(item => item.organisationId === organisationId)
        setInvite(membership || null)
      },
      reason => setMessage(`Could not load membership: ${reason.message}`),
    )
  }, [canJoin, organisationId, user])

  const phones = useMemo(
    () => organisation?.contactNumbers?.map(item => item.trim()).filter(Boolean) || [],
    [organisation?.contactNumbers],
  )

  function updateField(field: keyof ProfileForm, value: string) {
    setForm(current => ({ ...current, [field]: value }))
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, field: 'profilePhotoUrl' | 'logoUrl') {
    const file = event.target.files?.[0]
    if (!file || !user || !isOwner) return
    if (!file.type.startsWith('image/')) {
      setMessage('Choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('Images must be 5 MB or smaller.')
      return
    }
    setUploading(field)
    setMessage('')
    try {
      const imageRef = ref(storage, `organisation-profiles/${user.uid}/${field}`)
      await uploadBytes(imageRef, file, { contentType: file.type })
      const url = await getDownloadURL(imageRef)
      await updateDoc(doc(db, 'users', user.uid), { [field]: url })
      setForm(current => ({ ...current, [field]: url }))
      setMessage(field === 'logoUrl' ? 'Logo updated.' : 'Profile photo updated.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to upload this image.')
    } finally {
      setUploading('')
      event.target.value = ''
    }
  }

  async function removeImage(field: 'profilePhotoUrl' | 'logoUrl') {
    if (!user || !isOwner || !form[field]) return
    const label = field === 'logoUrl' ? 'logo' : 'profile photo'
    if (!window.confirm(`Remove the ${label}?`)) return
    setUploading(field)
    setMessage('')
    try {
      const imageRef = ref(storage, `organisation-profiles/${user.uid}/${field}`)
      try {
        await deleteObject(imageRef)
      } catch (reason) {
        const code = typeof reason === 'object' && reason && 'code' in reason ? reason.code : ''
        if (code !== 'storage/object-not-found') throw reason
      }
      await updateDoc(doc(db, 'users', user.uid), { [field]: '' })
      setForm(current => ({ ...current, [field]: '' }))
      setMessage(field === 'logoUrl' ? 'Logo removed.' : 'Profile photo removed.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : `Unable to remove the ${label}.`)
    } finally {
      setUploading('')
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !isOwner) return
    const name = form.name.trim()
    if (!name) {
      setMessage('Institute name is required.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        name,
        profilePhotoUrl: form.profilePhotoUrl.trim(),
        logoUrl: form.logoUrl.trim(),
        address: form.address.trim(),
        contactNumbers: form.contactNumbers.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean).slice(0, 6),
        googleMapsUrl: form.googleMapsUrl.trim(),
        instagramUrl: form.instagramUrl.trim(),
        facebookUrl: form.facebookUrl.trim(),
        profileUpdatedAt: serverTimestamp(),
      })
      setEditing(false)
      setMessage('Institute profile saved.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to save the profile.')
    } finally {
      setSaving(false)
    }
  }

  async function joinOrganisation() {
    if (!user || !profile || !organisation || !canJoin) return
    setSaving(true)
    setMessage('')
    try {
      const requestRef = doc(db, 'organisationInvites', `${organisationId}_${user.uid}`)
      if (invite?.status === 'pending' && invite.initiatedBy !== 'user') {
        await updateDoc(requestRef, { status: 'accepted', respondedAt: serverTimestamp() })
        setMessage(`You joined ${organisation.name || organisation.email}.`)
      } else if (invite?.status === 'declined') {
        await updateDoc(requestRef, { status: 'pending', initiatedBy: 'user', createdAt: serverTimestamp() })
        setMessage(`Join request sent to ${organisation.name || organisation.email}.`)
      } else if (!invite) {
        await setDoc(requestRef, {
          organisationId,
          organisationName: organisation.name || organisation.email,
          organisationEmail: organisation.email,
          userId: user.uid,
          userName: profile.name || profile.email,
          userEmail: profile.email,
          initiatedBy: 'user',
          status: 'pending',
          createdAt: serverTimestamp(),
        })
        setMessage(`Join request sent to ${organisation.name || organisation.email}.`)
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to update your membership.')
    } finally {
      setSaving(false)
    }
  }

  async function leaveOrganisation() {
    if (!invite || invite.status !== 'accepted' || !organisation) return
    if (!window.confirm(`Leave ${organisation.name || organisation.email}? You will lose access to its private tests and assignments.`)) return
    setSaving(true)
    setMessage('')
    try {
      await deleteDoc(doc(db, 'organisationInvites', invite.id))
      setMessage(`You left ${organisation.name || organisation.email}.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to leave this institute.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="mx-auto max-w-5xl animate-pulse"><div className="h-72 rounded-3xl bg-slate-200" /></section>
  if (!organisation) return <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-2xl font-black">Institute not found</h1><p className="mt-2 text-slate-500">This profile may no longer be available.</p><Link href="/invitations" className="mt-5 inline-flex font-bold text-indigo-600">Back to institutes</Link></section>

  const name = organisation.name || organisation.email
  const mapUrl = cleanUrl(organisation.googleMapsUrl)
  const instagramUrl = cleanUrl(organisation.instagramUrl)
  const facebookUrl = cleanUrl(organisation.facebookUrl)

  return <section className="mx-auto max-w-5xl">
    <Link href={canJoin ? '/invitations' : '/dashboard'} className="text-sm font-bold text-indigo-600 hover:text-indigo-800">← Back</Link>

    <article className="relative mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="relative h-36 bg-indigo-50 sm:h-48">
        {organisation.profilePhotoUrl && <Image src={organisation.profilePhotoUrl} alt="" fill sizes="(max-width: 1024px) 100vw, 1024px" className="object-cover" />}
      </div>
      <div className="px-5 pb-7 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="flex min-w-0 items-end gap-4">
            <ProfileLogo key={organisation.logoUrl || 'empty-logo'} src={organisation.logoUrl || ''} name={name} />
            <div className="min-w-0 pb-1">
              <p className="text-xs font-black uppercase tracking-[.2em] text-indigo-600">Institute profile</p>
              <h1 className="mt-1 truncate text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{name}</h1>
            </div>
          </div>
          <ProfileAction isOwner={isOwner} canJoin={canJoin} invite={invite} saving={saving} onEdit={() => setEditing(value => !value)} onJoin={() => void joinOrganisation()} onLeave={() => void leaveOrganisation()} />
        </div>
      </div>
    </article>

    {message && <p aria-live="polite" className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm font-semibold text-indigo-800">{message}</p>}

    {editing && isOwner
      ? <ProfileEditor form={form} saving={saving} uploading={uploading} updateField={updateField} uploadImage={uploadImage} removeImage={removeImage} submit={saveProfile} cancel={() => { setForm(profileFormFrom(organisation)); setEditing(false) }} />
      : <ProfileDetails organisation={organisation} phones={phones} mapUrl={mapUrl} instagramUrl={instagramUrl} facebookUrl={facebookUrl} />}
  </section>
}

function ProfileLogo({ src, name }: { src: string; name: string }) {
  const [aspectRatio, setAspectRatio] = useState(1)

  function updateAspectRatio(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    const naturalRatio = image.naturalWidth / image.naturalHeight
    if (!Number.isFinite(naturalRatio)) return

    setAspectRatio(naturalRatio >= 1.2 ? Math.min(naturalRatio, 2) : 1)
  }

  const style = { '--logo-aspect': aspectRatio } as CSSProperties

  return <div style={style} className="organisation-profile-logo relative -mt-12 grid h-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-indigo-50 text-3xl font-black text-indigo-700 shadow-md sm:-mt-14 sm:h-28">
    {src
      ? <Image src={src} alt={`${name} logo`} fill sizes="(max-width: 639px) 192px, 224px" className="object-contain p-2" onLoad={updateAspectRatio} />
      : name.slice(0, 1).toUpperCase()}
  </div>
}

function ProfileAction({ isOwner, canJoin, invite, saving, onEdit, onJoin, onLeave }: { isOwner: boolean; canJoin: boolean; invite: OrganisationInvite | null; saving: boolean; onEdit: () => void; onJoin: () => void; onLeave: () => void }) {
  if (isOwner) return <button type="button" onClick={onEdit} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">Edit profile</button>
  if (!canJoin) return null
  if (invite?.status === 'accepted') return <button type="button" disabled={saving} onClick={onLeave} className="rounded-xl border border-rose-200 bg-white px-5 py-3 text-sm font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50">Leave institute</button>
  if (invite?.status === 'pending' && invite.initiatedBy === 'user') return <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-700">Request pending</span>
  return <button type="button" disabled={saving} onClick={onJoin} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Please wait…' : invite?.status === 'pending' ? 'Join institute' : invite?.status === 'declined' ? 'Request again' : 'Request to join'}</button>
}

function ProfileDetails({ organisation, phones, mapUrl, instagramUrl, facebookUrl }: { organisation: UserProfile; phones: string[]; mapUrl: string; instagramUrl: string; facebookUrl: string }) {
  const hasLinks = mapUrl || instagramUrl || facebookUrl
  return <div className="mt-7 grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-black uppercase tracking-[.18em] text-slate-400">Visit us</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">Address & contact</h2>
      <dl className="mt-6 space-y-6">
        <Detail label="Address" value={organisation.address || 'Address not added yet.'} preserveLines />
        <div>
          <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Contact numbers</dt>
          <dd className="mt-2 space-y-1.5">{phones.length ? phones.map(phone => <a key={phone} href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="block w-fit font-bold text-indigo-700 hover:underline">{phone}</a>) : <span className="text-slate-500">No contact numbers added yet.</span>}</dd>
        </div>
        <Detail label="Email" value={organisation.email} href={`mailto:${organisation.email}`} />
      </dl>
    </section>
    <aside className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm sm:p-8">
      <p className="text-xs font-black uppercase tracking-[.18em] text-indigo-300">Connect</p>
      <h2 className="mt-2 text-2xl font-black">Find this institute online</h2>
      <div className="mt-6 grid gap-3">
        {mapUrl && <ExternalLink href={mapUrl}>Open in Google Maps</ExternalLink>}
        {instagramUrl && <ExternalLink href={instagramUrl}>Instagram</ExternalLink>}
        {facebookUrl && <ExternalLink href={facebookUrl}>Facebook</ExternalLink>}
        {!hasLinks && <p className="text-sm leading-6 text-slate-400">Online links have not been added yet.</p>}
      </div>
    </aside>
  </div>
}

function Detail({ label, value, href, preserveLines = false }: { label: string; value: string; href?: string; preserveLines?: boolean }) {
  return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</dt><dd className={`mt-2 leading-7 text-slate-700 ${preserveLines ? 'whitespace-pre-line' : ''}`}>{href ? <a href={href} className="font-bold text-indigo-700 hover:underline">{value}</a> : value}</dd></div>
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-white hover:border-indigo-400 hover:bg-slate-900"><span>{children}</span><span aria-hidden="true">↗</span></a>
}

function ProfileEditor({ form, saving, uploading, updateField, uploadImage, removeImage, submit, cancel }: { form: ProfileForm; saving: boolean; uploading: 'profilePhotoUrl' | 'logoUrl' | ''; updateField: (field: keyof ProfileForm, value: string) => void; uploadImage: (event: ChangeEvent<HTMLInputElement>, field: 'profilePhotoUrl' | 'logoUrl') => void; removeImage: (field: 'profilePhotoUrl' | 'logoUrl') => void; submit: (event: FormEvent<HTMLFormElement>) => void; cancel: () => void }) {
  const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
  return <form onSubmit={submit} className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-xs font-black uppercase tracking-[.18em] text-indigo-600">Profile settings</p><h2 className="mt-1 text-2xl font-black">Edit institute details</h2></div><p className="text-xs text-slate-500">Images: JPG, PNG or WebP, up to 5 MB</p></div>
    <div className="mt-7 grid gap-5 sm:grid-cols-2">
      <ImageField label="Profile photo" preview={form.profilePhotoUrl} busy={uploading === 'profilePhotoUrl'} onChange={event => void uploadImage(event, 'profilePhotoUrl')} onRemove={() => void removeImage('profilePhotoUrl')} wide />
      <ImageField label="Logo" preview={form.logoUrl} busy={uploading === 'logoUrl'} onChange={event => void uploadImage(event, 'logoUrl')} onRemove={() => void removeImage('logoUrl')} />
      <label className="text-sm font-bold text-slate-800 sm:col-span-2">Institute name<input required maxLength={120} value={form.name} onChange={event => updateField('name', event.target.value)} className={inputClass} /></label>
      <label className="text-sm font-bold text-slate-800 sm:col-span-2">Address<textarea rows={4} maxLength={500} value={form.address} onChange={event => updateField('address', event.target.value)} placeholder="Street, city, state and postal code" className={inputClass} /></label>
      <label className="text-sm font-bold text-slate-800 sm:col-span-2">Contact numbers<textarea rows={3} value={form.contactNumbers} onChange={event => updateField('contactNumbers', event.target.value)} placeholder={'One number per line\n+91 98765 43210'} className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-500">Add up to six numbers, one per line.</span></label>
      <UrlField label="Google Maps link" value={form.googleMapsUrl} update={value => updateField('googleMapsUrl', value)} />
      <UrlField label="Instagram link" value={form.instagramUrl} update={value => updateField('instagramUrl', value)} />
      <UrlField label="Facebook link" value={form.facebookUrl} update={value => updateField('facebookUrl', value)} wide />
    </div>
    <div className="mt-8 flex justify-end gap-3"><button type="button" onClick={cancel} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button><button disabled={saving || Boolean(uploading)} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save profile'}</button></div>
  </form>
}

function UrlField({ label, value, update, wide = false }: { label: string; value: string; update: (value: string) => void; wide?: boolean }) {
  return <label className={`text-sm font-bold text-slate-800 ${wide ? 'sm:col-span-2' : ''}`}>{label}<input type="url" value={value} onChange={event => update(event.target.value)} placeholder="https://" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
}

function ImageField({ label, preview, busy, onChange, onRemove, wide = false }: { label: string; preview: string; busy: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void; onRemove: () => void; wide?: boolean }) {
  return <div className="text-sm font-bold text-slate-800"><p>{label}</p><div className={`mt-2 flex items-center gap-4 rounded-xl border border-dashed border-slate-300 p-3 ${wide ? 'sm:min-h-24' : ''}`}><span className={`relative grid shrink-0 place-items-center overflow-hidden bg-slate-100 text-xs font-black text-slate-400 ${wide ? 'h-16 w-24 rounded-lg' : 'h-16 w-16 rounded-xl'}`}>{preview ? <Image src={preview} alt="" fill sizes={wide ? '96px' : '64px'} className="object-cover" /> : 'Preview'}</span><div className="min-w-0"><label className="block cursor-pointer text-sm font-black text-indigo-700 hover:text-indigo-900">{busy ? 'Updating…' : preview ? 'Replace image' : 'Choose image'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={onChange} className="sr-only" /></label>{preview && <button type="button" disabled={busy} onClick={onRemove} className="mt-2 block text-xs font-bold text-rose-600 hover:underline disabled:opacity-50">Remove {label.toLowerCase()}</button>} {!preview && <span className="mt-1 block text-xs font-normal text-slate-500">Click to upload</span>}</div></div></div>
}
