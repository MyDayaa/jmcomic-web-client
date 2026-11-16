# MyDayaa deployment

Frontend: https://jm.mydayww.cc. API: https://jm-api.mydayww.cc.

The fork deploys the Worker and uploads the frontend to Cloudflare Pages through
`Verify and release`. Production deployment requires the applicable tests to pass.
The dedicated Worker name and Pages deployment job are fork configuration.

## Upstream synchronization

`Sync upstream` checks TunaFish2K/main every six hours, at minute 17 (UTC), and
can also be run manually. It uses a normal merge, preserving fork commits; it
never resets or force-pushes main. No upstream changes means no deployment.

A merge conflict aborts synchronization and fails the workflow. The current
production deployment is retained. Resolve the conflict in the fork before
running synchronization again.

After a successful update, the workflow explicitly dispatches `Verify and release`
with `workflow_dispatch`. This is necessary because pushes made with the
repository's `GITHUB_TOKEN` do not trigger another push workflow. Full verification
includes the fork's direct-reader regression before either production deploy job.
Failed verification leaves the current production version running.

For an end-to-end maintenance check with unchanged upstream, manually run
`Sync upstream` with `verify_now` enabled. This dispatches verification and
deployment without creating an artificial merge commit.

## Reader fix to retain

When a reader URL is opened directly without navigation photo data, pass
`undefined` as the photo query's initial data. A `null` initial value is considered
fresh for the query's 30-minute stale time and prevents the chapter request,
leaving the reader at its loading screen.

Regression coverage:

- `packages/page/test/reader-data.test.tsx`: direct entry with absent/null photo.
- `packages/page/test/browser/sdk-app-flow.spec.ts`: a fresh direct URL must request
  the chapter and display an image decoded through the SDK worker.
