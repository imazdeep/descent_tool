# Descent Planner

A web tool for planning the descent of a SimBrief flight. It loads your latest
SimBrief dispatch, works out the idle descent path back from the runway, and
lets you type in the altitude and speed restrictions from the arrival chart or
from ATC to see how the path and the top of descent move.

For flight simulation only.

## What it shows

- **When to start down**: the top of descent as a distance from the
  destination and from the nearest fix, with the planned time.
- **Profile**: the computed path with each fix, your restrictions and the top
  of descent. Hover for altitude, speed and rate at any point. A stretch that
  needs speedbrake is drawn in orange, one that is too steep in red.
- **Map**: the same path over the arrival, with crossing altitudes.
- **Waypoints**: the altitude and speed to expect at each fix. Add a
  restriction (at, at or above, at or below, between, and a maximum speed) to
  any fix, or add a point at a distance before or after a fix.
- **Am I on the path?**: enter your position and altitude to see how far above
  or below the path you are and the rate needed to recover.
- **Settings**: aircraft, weight, speeds, approach, extra track miles and
  winds. Light and dark themes.

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
