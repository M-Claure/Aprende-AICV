/**
 * Terms & conditions / privacy notice consent.
 *
 * We link to Aprende's official "Aviso de privacidad" (the canonical, always-
 * current page) rather than embedding a snapshot that could drift. The checkbox
 * on the home page requires the user to accept it before starting the builder,
 * and `TERMS_VERSION` is recorded on the profile as proof-of-consent.
 *
 * This module is plain data only (no imports) so it is safe on both the client
 * (home-page checkbox/link) and the server (route that stamps the version).
 * The SERVER is the source of truth for the accepted version.
 *
 * When Aprende publishes a new version of the notice, bump `TERMS_VERSION` to
 * its new "fecha de entrada en vigencia" so stored consents stay meaningful.
 */

/** Effective date of the official aviso de privacidad currently in force. */
export const TERMS_VERSION = "2025-09-29";

/** Canonical, always-current privacy notice. Opened in a new tab. */
export const TERMS_URL = "https://aprende.com/avisos-de-privacidad/";

/** User-facing label for the notice (Spanish). */
export const TERMS_LABEL = "aviso de privacidad";
