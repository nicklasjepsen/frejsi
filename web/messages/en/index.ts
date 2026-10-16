// The en message tree: one JSON file per top-level namespace, kept in alphabetical order.
// A new screen adds its own <namespace>.json here and in the other locale, plus one import
// and one key below (docs/agent-workflow.md §3).
import accent from "./accent.json";
import app from "./app.json";
import chart from "./chart.json";
import eat from "./eat.json";
import errors from "./errors.json";
import foodKit from "./foodKit.json";
import glucose from "./glucose.json";
import history from "./history.json";
import historyWeek from "./historyWeek.json";
import invite from "./invite.json";
import library from "./library.json";
import locale from "./locale.json";
import log from "./log.json";
import mealDetail from "./mealDetail.json";
import nav from "./nav.json";
import now from "./now.json";
import passkey from "./passkey.json";
import people from "./people.json";
import roles from "./roles.json";
import say from "./say.json";
import settings from "./settings.json";
import shell from "./shell.json";
import soon from "./soon.json";
import source from "./source.json";
import stats from "./stats.json";
import today from "./today.json";
import viewer from "./viewer.json";
import welcome from "./welcome.json";

const messages = {
  accent,
  app,
  chart,
  eat,
  errors,
  foodKit,
  glucose,
  history,
  historyWeek,
  invite,
  library,
  locale,
  log,
  mealDetail,
  nav,
  now,
  passkey,
  people,
  roles,
  say,
  settings,
  shell,
  soon,
  source,
  stats,
  today,
  viewer,
  welcome,
};

export default messages;
