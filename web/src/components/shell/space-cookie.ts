/**
 * The space chosen on this device (design gap 11): a per-device preference, not space data, so
 * no event is emitted for it. Its own module because the server-action file may export only
 * async functions.
 */
export const SPACE_COOKIE = "frejsi_space";
