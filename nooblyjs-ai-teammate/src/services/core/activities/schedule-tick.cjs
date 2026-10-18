// Core scheduling runs each beat of a scheduled task as this activity, in a working-service worker thread. The
// schedule check itself (reading schedules and starting the due ones) needs the app's repositories and model
// providers, so it runs in the main process, in the callback SchedulerService registers. This activity only marks
// the beat, so every check is listed with its timing on /services/scheduling/.
module.exports = {
  run: async (data) => ({ app: data?.app ?? 'teammates', beatAt: new Date().toISOString() }),
};
