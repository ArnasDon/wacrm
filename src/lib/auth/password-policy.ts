// AUTH-N5: single source of truth for the client-side password-length
// floor, shared by every flow that writes a password — signup,
// change-password (Settings), and recovery (reset-password). Before
// this, each of the three files declared its own `MIN_PASSWORD`
// independently, and one of them (signup) had drifted to 6 while the
// other two said 8, with neither backed by Supabase Auth's own
// "Minimum password length" setting (also raised to 8 as part of this
// fix — see AUDIT-ROADMAP.md).
//
// This constant only needs to match Supabase's real server-side
// minimum so none of the three flows ever promises the user a floor
// the server won't actually enforce. It is intentionally just a
// number, not a bigger "password policy" abstraction — there is no
// client-side character-class check anywhere in this app (letters
// digits/symbols requirements are enforced by Supabase Auth itself,
// server-side, the same way `current_password` is for AUTH-N4), so a
// larger shared module would have nothing else to hold today.
export const MIN_PASSWORD = 8;
