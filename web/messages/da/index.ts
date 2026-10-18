// The da message tree: one JSON file per top-level namespace, kept in alphabetical order.
// A new screen adds its own <namespace>.json here and in the other locale, plus one import
// and one key below (docs/agent-workflow.md §3).
import accent from "./accent.json";
import app from "./app.json";
import ask from "./ask.json";
import chart from "./chart.json";
import eat from "./eat.json";
import errors from "./errors.json";
import foodCategory from "./foodCategory.json";
import foodKit from "./foodKit.json";
import glucose from "./glucose.json";
import history from "./history.json";
import historyWeek from "./historyWeek.json";
import invite from "./invite.json";
import library from "./library.json";
import locale from "./locale.json";
import log from "./log.json";
import manual from "./manual.json";
import mealDetail from "./mealDetail.json";
import nav from "./nav.json";
import now from "./now.json";
import passkey from "./passkey.json";
import people from "./people.json";
import pump from "./pump.json";
import pumpMeal from "./pumpMeal.json";
import recipe from "./recipe.json";
import roles from "./roles.json";
import say from "./say.json";
import settings from "./settings.json";
import shell from "./shell.json";
import soon from "./soon.json";
import source from "./source.json";
import stats from "./stats.json";
import symptoms from "./symptoms.json";
import today from "./today.json";
import viewer from "./viewer.json";
import welcome from "./welcome.json";

const messages = {
  accent,
  app,
  ask,
  chart,
  eat,
  errors,
  foodCategory,
  foodKit,
  glucose,
  history,
  historyWeek,
  invite,
  library,
  locale,
  log,
  manual,
  mealDetail,
  nav,
  now,
  passkey,
  people,
  pump,
  pumpMeal,
  recipe,
  roles,
  say,
  settings,
  shell,
  soon,
  source,
  stats,
  symptoms,
  today,
  viewer,
  welcome,
};

export default messages;
