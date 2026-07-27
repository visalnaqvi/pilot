import { OrganisationProfile } from '@/app/_components/organisation-profile'

export default async function OrganisationProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OrganisationProfile organisationId={id} />
}
