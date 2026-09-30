import { redirect } from 'next/navigation';

// The advanced wizard is now a mode of the campaign wizard.
export default function NewAdvancedCampaignPage() {
  redirect('/broadcasts/new?mode=advanced');
}
