# Schedules

Schedules lists every recurring job on your machines in one place: cz's own
scheduled tasks, and the nightly or weekly jobs that run outside cz as systemd
timers (launchd jobs on a Mac). Each row says what the job does, when it
runs, how its last run went and when the next one is.

Open it from the clock in the feed's top bar, the command palette, or
**Settings → Schedules** on the phone. It follows the feed's machine filter;
the clock shows a red dot when a job on a machine you're looking at failed.

Failed jobs come first, with the reason. A job that failed on schedule and
then worked when retried by hand still shows the failed scheduled run. "Needs
you" means the job ran and found something for you, said in its summary.

## Adding a job

A timer you set up by hand shows up on its own, described by its service's
`Description=`. Registering it adds a plain description, a project and where
its output goes:

```sh
cz jobs add --unit nightly-report.timer --description "Build the nightly report"
```

`--output` says where the latest output is (a file, folder or URL), and
`--project` which project it belongs to. `cz jobs list` prints what the view
shows; `cz jobs remove <name>` unregisters a job without touching the timer.
The timers Linux and its packages install (apt, logrotate, snap...) stay
hidden under **Show system timers**.
