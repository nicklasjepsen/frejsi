/**
 * The Apple App Site Association file (plan 2026-11-08-ios-follower-app §3): links under `/follow`
 * on this host open the iPhone app (team B32HGH682W, bundle ninja.jepsen.naensom), which matches the
 * `applinks:naensom.jepsen.ninja` entitlement in ios/project.yml. The `components` form needs iOS 13
 * or later; the app's deployment target is 17.2, so the legacy `paths` form is left out.
 */
export const IOS_APP_ID = "B32HGH682W.ninja.jepsen.naensom";

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [{ appIDs: [IOS_APP_ID], components: [{ "/": "/follow*" }] }],
  },
} as const;
