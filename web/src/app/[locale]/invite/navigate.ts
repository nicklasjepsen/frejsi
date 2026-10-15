/**
 * Where the browser goes once a ceremony has signed this device in. A full navigation, not the
 * router: the verify response set the session cookie, and the `(app)` layout reads it on the
 * server, so the next request has to be a real one. Tests replace this module.
 */
export function navigate(href: string): void {
  window.location.assign(href);
}
