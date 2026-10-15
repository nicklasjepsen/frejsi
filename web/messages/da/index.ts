// The da message tree: one JSON file per top-level namespace, kept in alphabetical order.
// A new screen adds its own <namespace>.json here and in the other locale, plus one import
// and one key below (docs/agent-workflow.md §3).
import accent from "./accent.json";
import app from "./app.json";
import errors from "./errors.json";
import foodKit from "./foodKit.json";
import glucose from "./glucose.json";
import invite from "./invite.json";
import locale from "./locale.json";
import log from "./log.json";
import nav from "./nav.json";
import now from "./now.json";
import passkey from "./passkey.json";
import people from "./people.json";
import roles from "./roles.json";
import settings from "./settings.json";
import shell from "./shell.json";
import soon from "./soon.json";
import source from "./source.json";
import viewer from "./viewer.json";
import welcome from "./welcome.json";

const messages = {
  accent,
  app,
  errors,
  foodKit,
  glucose,
  invite,
  locale,
  log,
  nav,
  now,
  passkey,
  people,
  roles,
  settings,
  shell,
  soon,
  source,
  viewer,
  welcome,
};

export default messages;
