// A fixed wall clock, with real timers, for the standalone process and the seed child process.
// Artboard meals include 12:10; release checks must work even when CI runs before lunch.
const RealDate = Date;
const instant = process.env.E2E_NOW;
if (!instant || !Number.isFinite(RealDate.parse(instant))) throw new Error("E2E_NOW is required");
class ReleaseDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(instant);
    else super(...args);
  }
  static parse(value) {
    return RealDate.parse(value);
  }
  static UTC(...args) {
    return RealDate.UTC(...args);
  }
  static now() {
    return RealDate.parse(instant);
  }
}
global.Date = ReleaseDate;
