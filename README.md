# Descent Planner

A web tool for planning the descent of a SimBrief flight. It loads your latest
SimBrief dispatch, works out the idle descent path back from the runway, and
lets you type in the altitude and speed restrictions from the arrival chart or
from ATC to see how the path and the top of descent move.

For flight simulation only.

## What it shows

- **Vertical profile** with the computed path, restriction symbols, top of
  descent, deceleration points, the glidepath intercept, the SimBrief planned
  profile for comparison and the minimum off-route altitude along the route.
  Speed, vertical speed and along-track wind share the same distance axis.
- **Route map** with the path coloured the same way, plus predicted crossing
  altitudes at each fix.
- **Restrictions table**: at, at or above, at or below, or a window, and a
  maximum speed, per fix. Points can be added at a distance before or after a
  fix for clearances like "be level 20 miles before X".
- **Sequence** of the events in the descent, in order.
- **Position check**: enter where you are to see how far above or below the
  path you sit and the rate needed to make the next restriction.
- **Setup**: aircraft type, weight, speeds, approach, extra track miles and
  winds (flight plan forecast, your own, or calm).

## How the path is computed

The path is built backwards from the runway threshold: up the glidepath, then
idle-thrust segments at the scheduled speed (Mach, then speed, then the speed
limit below FL100). At each altitude restriction the idle path is clamped into
the allowed window; a clamped segment becomes a fixed straight path, and the
tool reports whether it needs speedbrake or is too steep to hold speed. Where
the speed schedule steps down, a shallow deceleration segment is inserted.

Performance comes from an approximate point-mass model per aircraft type (drag
polar and idle thrust), with the forecast wind and temperature at every fix
and level from the SimBrief plan. Use the drag setting to trim it against your
aircraft.

## Develop

```
npm install
npm run dev
npm test
npm run build
```

Built with Vite, React and TypeScript. Deploys to Vercel as a static site.
