'use client'

import { useBrand } from './brand-provider'

export function BrandLogo({ inverse = false, className = '' }: { inverse?: boolean; className?: string }) {
  const brand = useBrand()

  if (brand.logoUrl) {
    return (
      <span className={`inline-flex max-w-48 items-center rounded-md ${inverse ? 'bg-white/95 px-2.5 py-1.5' : ''} ${className}`}>
        {/* A deployment-controlled URL supports local public assets and client-hosted logos. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={brand.logoAlt} className="h-8 w-auto max-w-full object-contain" />
      </span>
    )
  }

  return (
    <span className={`${inverse ? 'text-white' : 'text-indigo-600'} text-xl font-black tracking-tight ${className}`}>
      {brand.shortName}
    </span>
  )
}
