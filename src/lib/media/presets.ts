// S3-compatible storage presets — shared by the Storage settings UI
// and the server. `{region}` / `{account}` in endpoints are filled
// from the form.

export interface S3Preset {
  id: string
  label: string
  /** Endpoint template; null = AWS default (derived from region). */
  endpoint: string | null
  needsAccountId?: boolean
  defaultRegion: string
  regionHint: string
  forcePathStyle: boolean
  help: string
}

export const S3_PRESETS: S3Preset[] = [
  {
    id: 'aws',
    label: 'Amazon S3',
    endpoint: null,
    defaultRegion: 'eu-west-2',
    regionHint: 'e.g. eu-west-2 (London), af-south-1 (Cape Town), us-east-1',
    forcePathStyle: false,
    help: 'IAM → create a user with s3:PutObject, s3:GetObject, s3:DeleteObject on your bucket.',
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    endpoint: 'https://{account}.r2.cloudflarestorage.com',
    needsAccountId: true,
    defaultRegion: 'auto',
    regionHint: 'Always "auto" for R2',
    forcePathStyle: false,
    help: 'R2 → Manage API tokens → Object Read & Write. No egress fees.',
  },
  {
    id: 'spaces',
    label: 'DigitalOcean Spaces',
    endpoint: 'https://{region}.digitaloceanspaces.com',
    defaultRegion: 'fra1',
    regionHint: 'e.g. fra1, ams3, nyc3',
    forcePathStyle: false,
    help: 'API → Spaces Keys → Generate New Key.',
  },
  {
    id: 'b2',
    label: 'Backblaze B2',
    endpoint: 'https://s3.{region}.backblazeb2.com',
    defaultRegion: 'eu-central-003',
    regionHint: 'From the bucket\'s S3 endpoint, e.g. eu-central-003',
    forcePathStyle: false,
    help: 'App Keys → Add a New Application Key with read/write on the bucket.',
  },
  {
    id: 'wasabi',
    label: 'Wasabi',
    endpoint: 'https://s3.{region}.wasabisys.com',
    defaultRegion: 'eu-central-1',
    regionHint: 'e.g. eu-central-1, us-east-1',
    forcePathStyle: false,
    help: 'Access Keys → Create new access key.',
  },
  {
    id: 'custom',
    label: 'Other S3-compatible (MinIO…)',
    endpoint: '',
    defaultRegion: 'us-east-1',
    regionHint: 'Whatever your server expects (MinIO: us-east-1)',
    forcePathStyle: true,
    help: 'Any service speaking the S3 API. Self-hosted endpoints on private addresses require ALLOW_PRIVATE_ENDPOINTS=true on single-tenant installs.',
  },
]

export function getS3Preset(id: string): S3Preset | undefined {
  return S3_PRESETS.find((p) => p.id === id)
}

export function resolveEndpoint(preset: S3Preset, vals: { region: string; accountId?: string; custom?: string }): string | null {
  if (preset.endpoint === null) return null
  if (preset.id === 'custom') return vals.custom?.trim() || null
  return preset.endpoint.replace('{region}', vals.region).replace('{account}', vals.accountId ?? '')
}
