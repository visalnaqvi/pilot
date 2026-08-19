import { AuthForm } from '@/app/_components/auth-form'

type SearchValue = string | string[] | undefined

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: SearchValue }>
}) {
  const value = (await searchParams).returnTo
  return <AuthForm mode="login" returnTo={Array.isArray(value) ? value[0] : value} />
}
