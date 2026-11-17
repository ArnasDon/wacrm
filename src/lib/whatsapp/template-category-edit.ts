export function canEditTemplateCategory(status: string | null | undefined): boolean {
  return status !== 'APPROVED'
}
