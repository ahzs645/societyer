// Preload for `npm run test:legal:after-utc-midnight`. Moves the clock to 00:30
// UTC on the next day, when the UTC date is already a day ahead of every
// Canadian time zone. A check that builds "today" from toISOString() instead of
// the organization's local date fails here, whatever time CI happens to run.
const RealDate = Date;
const target = new RealDate();
target.setUTCDate(target.getUTCDate() + 1);
target.setUTCHours(0, 30, 0, 0);
const offset = target.getTime() - RealDate.now();

class ShiftedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }
  static now() {
    return RealDate.now() + offset;
  }
}

globalThis.Date = ShiftedDate;
